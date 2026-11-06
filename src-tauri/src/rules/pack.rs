use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const RULEPACK_MAX_BYTES: usize = 1_048_576;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RulePack {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub ai: Option<AiMeta>,
    /// `decoded` (default) or `raw_hex`.
    #[serde(default = "default_presentation")]
    pub presentation: String,
    #[serde(default)]
    pub filters: Vec<FilterDef>,
    pub line_rules: Vec<LineRule>,
    pub frame: FrameDef,
    #[serde(default)]
    pub commands: Vec<CommandDef>,
    #[serde(default)]
    pub examples: Vec<RuleExample>,
}

fn default_presentation() -> String {
    "decoded".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMeta {
    #[serde(default)]
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterDef {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineRule {
    pub id: String,
    pub pattern: String,
    pub dir_group: usize,
    pub dir_map: std::collections::BTreeMap<String, String>,
    pub hex_group: usize,
    #[serde(default)]
    pub time_group: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrameDef {
    /// `length_prefix` (default, AA55-style), `mdb_adapter`, or `mixed`
    /// (AA55 when headers match, otherwise MDB).
    #[serde(default = "default_frame_kind")]
    pub kind: String,
    #[serde(default)]
    pub tx_header: Vec<u8>,
    #[serde(default)]
    pub rx_header: Vec<u8>,
    #[serde(default = "default_checksum")]
    pub checksum: String,
    /// MDB-RS232 device base addresses used to detect unsolicited reports.
    #[serde(default)]
    pub device_bases: Vec<u8>,
}

fn default_frame_kind() -> String {
    "length_prefix".to_string()
}

fn default_checksum() -> String {
    "sum8_before_last".to_string()
}

pub const VIEW_MAX_BLOCKS: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandDef {
    pub cmd: u8,
    pub name: String,
    pub title: String,
    #[serde(default)]
    pub decode: Vec<DecodeStep>,
    /// Optional declarative card layout. Empty / omitted → default clause sentence.
    #[serde(default)]
    pub view: Vec<ViewBlock>,
    /// Optional direction filter: `tx` or `rx`.
    #[serde(default)]
    pub dir: Option<String>,
    /// Optional sub-command / event byte after `cmd`.
    #[serde(default)]
    pub sub: Option<u8>,
    /// `command` | `report` | `reply` | `control` (MDB adapter).
    #[serde(default)]
    pub role: Option<String>,
    /// Per-command checksum override: `none` | `sum8_tail`.
    #[serde(default)]
    pub checksum: Option<String>,
    /// Exact total frame length in bytes (optional match filter).
    #[serde(default)]
    pub len: Option<usize>,
    /// Optional payload prefix after the command byte (length-prefix / mixed).
    #[serde(default)]
    pub payload_prefix: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ViewBlock {
    Heading {
        #[serde(default)]
        text: Option<String>,
    },
    Kv {
        bind: String,
        #[serde(default)]
        label: Option<String>,
    },
    Status {
        bind: String,
    },
    Flags {
        bind: String,
    },
    Hex {
        #[serde(default)]
        bind: Option<String>,
        #[serde(default)]
        from_bytes: Option<(usize, usize)>,
        #[serde(default)]
        label: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DecodeStep {
    Uint {
        id: String,
        offset: usize,
        width: usize,
        #[serde(default = "default_endian")]
        endian: String,
        #[serde(default)]
        label: Option<String>,
    },
    Bits {
        from: String,
        start: u8,
        width: u8,
        id: String,
        #[serde(default)]
        map: std::collections::BTreeMap<String, String>,
        #[serde(default)]
        label: Option<String>,
    },
    Flags {
        from: String,
        bits: Vec<FlagBit>,
        #[serde(default)]
        label: Option<String>,
        #[serde(default)]
        id: Option<String>,
    },
    Groups {
        from_bytes: Option<(usize, usize)>,
        #[serde(default)]
        from: Option<String>,
        group_bits: u8,
        equals: u64,
        code: String,
        label: String,
        #[serde(default)]
        reorder: Option<Vec<usize>>,
        #[serde(default)]
        id: Option<String>,
    },
    HexDump {
        id: String,
        #[serde(default)]
        label: Option<String>,
    },
    Ascii {
        id: String,
        offset: usize,
        width: usize,
        #[serde(default)]
        label: Option<String>,
    },
}

fn default_endian() -> String {
    "be".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlagBit {
    pub bit: u8,
    pub label: String,
    #[serde(default)]
    pub fault: bool,
    #[serde(default)]
    pub code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleExample {
    pub input: String,
    #[serde(default)]
    pub note: String,
}

pub fn parse_rulepack_json(raw: &str) -> AppResult<RulePack> {
    if raw.len() > RULEPACK_MAX_BYTES {
        return Err(AppError::msg(format!(
            "规则包超过大小上限 {} 字节",
            RULEPACK_MAX_BYTES
        )));
    }
    let value: Value = serde_json::from_str(raw)?;
    validate_shape(&value)?;
    let pack: RulePack = serde_json::from_value(value)?;
    validate_pack(&pack)?;
    Ok(pack)
}

fn path_err(path: &str, msg: &str) -> AppError {
    AppError::msg(format!("{path}: {msg}"))
}

fn validate_shape(value: &Value) -> AppResult<()> {
    let obj = value
        .as_object()
        .ok_or_else(|| path_err("$", "规则包根节点必须是对象"))?;
    for key in ["id", "name", "version", "line_rules", "frame"] {
        if !obj.contains_key(key) {
            return Err(path_err(&format!("$.{key}"), "缺少必填字段"));
        }
    }
    if !obj["line_rules"].is_array() {
        return Err(path_err("$.line_rules", "必须是数组"));
    }
    if !obj["frame"].is_object() {
        return Err(path_err("$.frame", "必须是对象"));
    }
    Ok(())
}

fn validate_pack(pack: &RulePack) -> AppResult<()> {
    if pack.id.trim().is_empty() {
        return Err(path_err("$.id", "不能为空"));
    }
    if pack.presentation != "decoded" && pack.presentation != "raw_hex" {
        return Err(path_err(
            "$.presentation",
            "只能是 decoded 或 raw_hex",
        ));
    }
    if pack.line_rules.is_empty() {
        return Err(path_err("$.line_rules", "至少需要一条行规则"));
    }
    if pack.frame.kind != "length_prefix"
        && pack.frame.kind != "mdb_adapter"
        && pack.frame.kind != "mixed"
    {
        return Err(path_err(
            "$.frame.kind",
            "只能是 length_prefix、mdb_adapter 或 mixed",
        ));
    }
    if (pack.frame.kind == "length_prefix" || pack.frame.kind == "mixed")
        && (pack.frame.tx_header.is_empty() || pack.frame.rx_header.is_empty())
    {
        return Err(path_err("$.frame", "tx_header / rx_header 不能为空"));
    }
    for (i, rule) in pack.line_rules.iter().enumerate() {
        if rule.pattern.len() > 4096 {
            return Err(path_err(
                &format!("$.line_rules[{i}].pattern"),
                "正则过长",
            ));
        }
        regex::Regex::new(&rule.pattern).map_err(|e| {
            path_err(
                &format!("$.line_rules[{i}].pattern"),
                &format!("非法正则: {e}"),
            )
        })?;
    }
    for (ci, cmd) in pack.commands.iter().enumerate() {
        validate_command_view(ci, cmd)?;
    }
    Ok(())
}

fn decode_bind_ids(cmd: &CommandDef) -> std::collections::BTreeSet<String> {
    let mut ids = std::collections::BTreeSet::new();
    for step in &cmd.decode {
        match step {
            DecodeStep::Uint { id, .. }
            | DecodeStep::Bits { id, .. }
            | DecodeStep::HexDump { id, .. }
            | DecodeStep::Ascii { id, .. } => {
                ids.insert(id.clone());
            }
            DecodeStep::Flags { from, id, .. } => {
                if let Some(id) = id {
                    ids.insert(id.clone());
                }
                ids.insert(from.clone());
            }
            DecodeStep::Groups { from, id, code, .. } => {
                if let Some(id) = id {
                    ids.insert(id.clone());
                }
                if let Some(from) = from {
                    ids.insert(from.clone());
                }
                ids.insert(code.clone());
            }
        }
    }
    ids
}

fn validate_command_view(ci: usize, cmd: &CommandDef) -> AppResult<()> {
    if cmd.view.is_empty() {
        return Ok(());
    }
    if cmd.view.len() > VIEW_MAX_BLOCKS {
        return Err(path_err(
            &format!("$.commands[{ci}].view"),
            &format!("最多 {VIEW_MAX_BLOCKS} 个控件"),
        ));
    }
    let ids = decode_bind_ids(cmd);
    for (vi, block) in cmd.view.iter().enumerate() {
        let path = format!("$.commands[{ci}].view[{vi}]");
        match block {
            ViewBlock::Heading { .. } => {}
            ViewBlock::Kv { bind, .. } | ViewBlock::Status { bind } | ViewBlock::Flags { bind } => {
                if bind.trim().is_empty() || !ids.contains(bind) {
                    return Err(path_err(&path, &format!("bind `{bind}` 在 decode 中不存在")));
                }
            }
            ViewBlock::Hex {
                bind,
                from_bytes,
                ..
            } => {
                match (bind.as_ref(), from_bytes.as_ref()) {
                    (Some(b), _) if !b.trim().is_empty() => {
                        if !ids.contains(b) {
                            return Err(path_err(&path, &format!("bind `{b}` 在 decode 中不存在")));
                        }
                    }
                    (None, Some((off, width))) if *width > 0 => {
                        let _ = off;
                    }
                    _ => {
                        return Err(path_err(&path, "hex 需要 bind 或 from_bytes"));
                    }
                }
            }
        }
    }
    Ok(())
}

pub fn pack_to_pretty_json(pack: &RulePack) -> AppResult<String> {
    Ok(serde_json::to_string_pretty(pack)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_id() {
        let err = parse_rulepack_json(r#"{"name":"x","version":"1","line_rules":[],"frame":{}}"#)
            .unwrap_err()
            .to_string();
        assert!(err.contains("$.id") || err.contains("line_rules") || err.contains("frame"));
    }

    #[test]
    fn rejects_view_bad_bind() {
        let raw = r#"{
          "id":"t","name":"t","version":"1",
          "line_rules":[{"id":"r","pattern":"^(>) ([0-9A-F ]+)$","dir_group":1,"dir_map":{">":"tx"},"hex_group":2}],
          "frame":{"tx_header":[170,85],"rx_header":[165,90]},
          "commands":[{"cmd":30,"name":"A","title":"T","decode":[{"type":"uint","id":"x","offset":0,"width":1}],
            "view":[{"type":"kv","bind":"missing"}]}]
        }"#;
        let err = parse_rulepack_json(raw).unwrap_err().to_string();
        assert!(err.contains("bind"), "{err}");
    }

    #[test]
    fn rejects_view_too_long() {
        let blocks = (0..33)
            .map(|_| r#"{"type":"heading"}"#)
            .collect::<Vec<_>>()
            .join(",");
        let raw = format!(
            r#"{{
          "id":"t","name":"t","version":"1",
          "line_rules":[{{"id":"r","pattern":"^(>) ([0-9A-F ]+)$","dir_group":1,"dir_map":{{">":"tx"}},"hex_group":2}}],
          "frame":{{"tx_header":[170,85],"rx_header":[165,90]}},
          "commands":[{{"cmd":30,"name":"A","title":"T","view":[{blocks}]}}]
        }}"#
        );
        let err = parse_rulepack_json(&raw).unwrap_err().to_string();
        assert!(err.contains("最多"), "{err}");
    }
}
