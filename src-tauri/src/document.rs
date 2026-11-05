use crate::error::{AppError, AppResult};
use encoding_rs::{Encoding, GB18030, UTF_8};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum LineEnding {
    Crlf,
    Lf,
    Cr,
}

impl LineEnding {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Crlf => "\r\n",
            Self::Lf => "\n",
            Self::Cr => "\r",
        }
    }

    pub fn detect(text: &str) -> Self {
        let mut crlf = 0usize;
        let mut lf = 0usize;
        let mut cr = 0usize;
        let bytes = text.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            match bytes[i] {
                b'\r' if i + 1 < bytes.len() && bytes[i + 1] == b'\n' => {
                    crlf += 1;
                    i += 2;
                }
                b'\n' => {
                    lf += 1;
                    i += 1;
                }
                b'\r' => {
                    cr += 1;
                    i += 1;
                }
                _ => i += 1,
            }
        }
        if crlf >= lf && crlf >= cr && crlf > 0 {
            Self::Crlf
        } else if cr > lf && cr > 0 {
            Self::Cr
        } else {
            Self::Lf
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenedDocument {
    pub path: String,
    pub name: String,
    pub text: String,
    pub encoding: String,
    pub line_ending: LineEnding,
    pub encoding_warning: Option<String>,
}

fn decode_bytes(bytes: &[u8]) -> (String, String, Option<String>) {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let (cow, _, had_errors) = UTF_8.decode(&bytes[3..]);
        let warning = had_errors.then(|| "UTF-8 BOM 解码存在替换字符".to_string());
        return (cow.into_owned(), "UTF-8".to_string(), warning);
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let utf16: Vec<u16> = bytes[2..]
            .chunks(2)
            .filter_map(|c| {
                if c.len() == 2 {
                    Some(u16::from_le_bytes([c[0], c[1]]))
                } else {
                    None
                }
            })
            .collect();
        let text = String::from_utf16_lossy(&utf16);
        return (text, "UTF-16LE".to_string(), None);
    }
    if std::str::from_utf8(bytes).is_ok() {
        return (
            String::from_utf8(bytes.to_vec()).unwrap(),
            "UTF-8".to_string(),
            None,
        );
    }
    let (cow, _, had_errors) = GB18030.decode(bytes);
    if !had_errors {
        return (cow.into_owned(), "GB18030".to_string(), None);
    }
    let (cow, _, _) = encoding_rs::WINDOWS_1252.decode(bytes);
    (
        cow.into_owned(),
        "Latin-1".to_string(),
        Some("无法可靠识别编码，已按 Latin-1 打开".to_string()),
    )
}

fn encode_text(text: &str, encoding: &str) -> AppResult<Vec<u8>> {
    match encoding {
        "UTF-8" => Ok(text.as_bytes().to_vec()),
        "UTF-8-BOM" => {
            let mut out = vec![0xEF, 0xBB, 0xBF];
            out.extend_from_slice(text.as_bytes());
            Ok(out)
        }
        "GB18030" => {
            let (cow, _, unmatched) = GB18030.encode(text);
            if unmatched {
                return Err(AppError::msg("文本无法完整编码为 GB18030"));
            }
            Ok(cow.into_owned())
        }
        "Latin-1" => {
            let enc = Encoding::for_label(b"windows-1252").unwrap_or(encoding_rs::WINDOWS_1252);
            let (cow, _, unmatched) = enc.encode(text);
            if unmatched {
                return Err(AppError::msg("文本无法完整编码为 Latin-1"));
            }
            Ok(cow.into_owned())
        }
        other => Err(AppError::msg(format!("不支持的编码: {other}"))),
    }
}

fn normalize_newlines(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn apply_line_ending(text: &str, ending: LineEnding) -> String {
    let normalized = normalize_newlines(text);
    if ending == LineEnding::Lf {
        normalized
    } else {
        normalized.replace('\n', ending.as_str())
    }
}

pub fn open_path(path: &Path) -> AppResult<OpenedDocument> {
    let bytes = std::fs::read(path)?;
    let (text, encoding, warning) = decode_bytes(&bytes);
    let line_ending = LineEnding::detect(&text);
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());
    Ok(OpenedDocument {
        path: path.to_string_lossy().into_owned(),
        name,
        text: normalize_newlines(&text),
        encoding,
        line_ending,
        encoding_warning: warning,
    })
}

pub fn save_path(
    path: &Path,
    text: &str,
    encoding: &str,
    line_ending: LineEnding,
) -> AppResult<()> {
    let body = apply_line_ending(text, line_ending);
    let bytes = encode_text(&body, encoding)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, bytes)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn roundtrip_utf8_crlf() {
        let mut f = NamedTempFile::new().unwrap();
        write!(f, "a\r\nb\r\n").unwrap();
        let doc = open_path(f.path()).unwrap();
        assert_eq!(doc.text, "a\nb\n");
        assert_eq!(doc.line_ending, LineEnding::Crlf);
        assert_eq!(doc.encoding, "UTF-8");
        let out = NamedTempFile::new().unwrap();
        save_path(out.path(), &doc.text, "UTF-8", LineEnding::Crlf).unwrap();
        let saved = std::fs::read(out.path()).unwrap();
        assert_eq!(saved, b"a\r\nb\r\n");
    }

    #[test]
    fn detect_lf() {
        assert_eq!(LineEnding::detect("a\nb\n"), LineEnding::Lf);
    }
}
