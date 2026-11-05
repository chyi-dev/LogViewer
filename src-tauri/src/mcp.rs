use crate::crypto::encrypt_rulepack_json;
use crate::rules::parse_rulepack_json;
use serde_json::{json, Value};
use std::path::Path;

pub const AUTHORING_DOC: &str = include_str!("../../docs/ai/rulepack-authoring.md");
pub const SCHEMA_JSON: &str = include_str!("../../schema/rulepack-v1.schema.json");

pub fn handle_message(raw: &str) -> Option<String> {
    let msg: Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(e) => {
            return Some(
                json!({
                    "jsonrpc": "2.0",
                    "id": null,
                    "error": { "code": -32700, "message": format!("parse error: {e}") }
                })
                .to_string(),
            );
        }
    };

    let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let id = msg.get("id").cloned();

    // notifications: no response
    if id.is_none() || id.as_ref().is_some_and(|v| v.is_null()) {
        if method == "notifications/initialized" || method.starts_with("notifications/") {
            return None;
        }
    }

    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "log-viewer-mcp", "version": "0.1.0" }
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tool_defs() })),
        "tools/call" => call_tool(msg.get("params")),
        "" => Err((-32600, "invalid request".to_string())),
        other => Err((-32601, format!("method not found: {other}"))),
    };

    Some(match result {
        Ok(value) => json!({ "jsonrpc": "2.0", "id": id, "result": value }).to_string(),
        Err((code, message)) => {
            json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
                .to_string()
        }
    })
}

fn tool_defs() -> Vec<Value> {
    vec![
        json!({
            "name": "get_rulepack_standard",
            "description": "Return LogViewer rulepack authoring guide and JSON schema so an AI can build a valid rule pack.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        }),
        json!({
            "name": "encrypt_rulepack",
            "description": "Validate rulepack JSON then encrypt it to a .lvrule file with a passphrase. Does not import into the app library.",
            "inputSchema": {
                "type": "object",
                "required": ["json", "passphrase", "output_path"],
                "properties": {
                    "json": { "type": "string", "description": "Full rulepack JSON text" },
                    "passphrase": { "type": "string", "description": "Passphrase for .lvrule encryption" },
                    "output_path": { "type": "string", "description": "Destination .lvrule file path" }
                },
                "additionalProperties": false
            }
        }),
    ]
}

fn call_tool(params: Option<&Value>) -> Result<Value, (i32, String)> {
    let params = params.ok_or((-32602, "missing params".to_string()))?;
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .ok_or((-32602, "missing tool name".to_string()))?;
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));

    match name {
        "get_rulepack_standard" => Ok(tool_text(format!(
            "# Authoring guide\n\n{AUTHORING_DOC}\n\n# Schema (rulepack-v1.schema.json)\n\n{SCHEMA_JSON}\n"
        ))),
        "encrypt_rulepack" => encrypt_tool(&args),
        other => Err((-32602, format!("unknown tool: {other}"))),
    }
}

fn encrypt_tool(args: &Value) -> Result<Value, (i32, String)> {
    let json = args
        .get("json")
        .and_then(|v| v.as_str())
        .ok_or((-32602, "json is required".to_string()))?;
    let passphrase = args
        .get("passphrase")
        .and_then(|v| v.as_str())
        .ok_or((-32602, "passphrase is required".to_string()))?;
    let output_path = args
        .get("output_path")
        .and_then(|v| v.as_str())
        .ok_or((-32602, "output_path is required".to_string()))?;

    let pack = parse_rulepack_json(json).map_err(|e| (-32000, e.to_string()))?;
    let blob = encrypt_rulepack_json(json, passphrase).map_err(|e| (-32000, e.to_string()))?;

    let path = Path::new(output_path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| (-32000, e.to_string()))?;
        }
    }
    std::fs::write(path, &blob).map_err(|e| (-32000, e.to_string()))?;

    Ok(tool_text(format!(
        "Encrypted rulepack written.\nid: {}\nname: {}\nversion: {}\npath: {}",
        pack.id,
        pack.name,
        pack.version,
        path.display()
    )))
}

fn tool_text(text: String) -> Value {
    json!({
        "content": [{ "type": "text", "text": text }],
        "isError": false
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::decrypt_rulepack_blob;
    use tempfile::tempdir;

    const VALID: &str = r#"{
  "id": "mcp-demo",
  "name": "MCP Demo",
  "version": "1.0.0",
  "line_rules": [
    {
      "id": "r1",
      "pattern": "^(tx|rx)\\s+([0-9A-Fa-f ]+)$",
      "dir_group": 1,
      "dir_map": { "tx": "tx", "rx": "rx" },
      "hex_group": 2
    }
  ],
  "frame": {
    "tx_header": [170, 85],
    "rx_header": [165, 90],
    "checksum": "sum8_before_last"
  },
  "commands": []
}"#;

    fn result_of(raw: &str) -> Value {
        let resp = handle_message(raw).expect("response");
        serde_json::from_str(&resp).unwrap()
    }

    #[test]
    fn initialize_ok() {
        let v = result_of(
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}"#,
        );
        assert_eq!(v["result"]["serverInfo"]["name"], "log-viewer-mcp");
    }

    #[test]
    fn tools_list_has_both() {
        let v = result_of(r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#);
        let names: Vec<&str> = v["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"get_rulepack_standard"));
        assert!(names.contains(&"encrypt_rulepack"));
    }

    #[test]
    fn get_standard_embeds_docs() {
        let v = result_of(
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_rulepack_standard","arguments":{}}}"#,
        );
        let text = v["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("rulepack-v1.schema.json"));
        assert!(text.contains("encrypt_rulepack"));
        assert!(text.contains("\"title\": \"LogViewer RulePack v1\"") || text.contains("LogViewer RulePack v1"));
    }

    #[test]
    fn encrypt_tool_writes_file() {
        let dir = tempdir().unwrap();
        let out = dir.path().join("demo.lvrule");
        let req = json!({
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {
                "name": "encrypt_rulepack",
                "arguments": {
                    "json": VALID,
                    "passphrase": "secret-pass",
                    "output_path": out.to_str().unwrap()
                }
            }
        });
        let v = result_of(&req.to_string());
        assert_eq!(v["result"]["isError"], false);
        let blob = std::fs::read(&out).unwrap();
        let plain = decrypt_rulepack_blob(&blob, "secret-pass").unwrap();
        assert_eq!(plain, VALID);
    }

    #[test]
    fn initialized_notification_silent() {
        assert!(handle_message(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_none());
    }
}
