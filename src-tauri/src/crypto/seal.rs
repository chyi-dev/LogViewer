use crate::error::AppResult;
use crate::rules::parse_rulepack_json;

use super::rule_file::{decrypt_with_passphrase, encrypt_with_passphrase};

/// Validate rulepack JSON, then encrypt to `.lvrule` bytes.
pub fn encrypt_rulepack_json(json: &str, passphrase: &str) -> AppResult<Vec<u8>> {
    parse_rulepack_json(json)?;
    encrypt_with_passphrase(json.as_bytes(), passphrase)
}

/// Decrypt `.lvrule` bytes to UTF-8 text without schema validation.
pub fn decrypt_rulepack_blob(blob: &[u8], passphrase: &str) -> AppResult<String> {
    let plain = decrypt_with_passphrase(blob, passphrase)?;
    String::from_utf8(plain).map_err(|_| crate::error::AppError::msg("无法解密"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = r#"{
  "id": "demo-pack",
  "name": "Demo",
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

    #[test]
    fn rejects_invalid_json() {
        let err = encrypt_rulepack_json(r#"{"name":"x"}"#, "secret")
            .unwrap_err()
            .to_string();
        assert!(!err.is_empty());
    }

    #[test]
    fn roundtrip_valid_pack() {
        let blob = encrypt_rulepack_json(VALID, "secret-pass").unwrap();
        let out = decrypt_rulepack_blob(&blob, "secret-pass").unwrap();
        assert_eq!(out, VALID);
    }

    #[test]
    fn decrypt_skips_schema() {
        let raw = br#"{"not":"a valid pack"}"#;
        let blob = encrypt_with_passphrase(raw, "secret-pass").unwrap();
        let out = decrypt_rulepack_blob(&blob, "secret-pass").unwrap();
        assert_eq!(out.as_bytes(), raw);
    }
}
