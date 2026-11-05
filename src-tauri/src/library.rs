use crate::crypto::{
    decrypt_with_key, decrypt_with_passphrase, encrypt_with_key, encrypt_with_passphrase, KEY_LEN,
};
use crate::error::{AppError, AppResult};
use crate::rules::{pack_to_pretty_json, parse_rulepack_json, RulePack};
use keyring::Entry;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const SERVICE: &str = "com.chyi.log.viewer";
const KEY_USER: &str = "library-master-key";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleSummary {
    pub id: String,
    pub name: String,
    pub version: String,
    pub builtin: bool,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LibraryIndex {
    active_id: String,
    entries: Vec<IndexEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IndexEntry {
    id: String,
    name: String,
    version: String,
    builtin: bool,
    file: String,
}

pub struct RuleLibrary {
    root: PathBuf,
    key: [u8; KEY_LEN],
    index: LibraryIndex,
}

impl RuleLibrary {
    pub fn open(app_data: &Path) -> AppResult<Self> {
        let root = app_data.join("rules");
        fs::create_dir_all(&root)?;
        let key = load_or_create_key()?;
        let index_path = root.join("index.json");
        let mut lib = if index_path.exists() {
            let index: LibraryIndex = serde_json::from_str(&fs::read_to_string(&index_path)?)?;
            Self { root, key, index }
        } else {
            let lib = Self {
                root,
                key,
                index: LibraryIndex {
                    active_id: String::new(),
                    entries: vec![],
                },
            };
            lib.persist_index()?;
            lib
        };
        lib.clear_builtin_flags()?;
        lib.purge_legacy_default_rules()?;
        Ok(lib)
    }

    /// Clear leftover builtin flags from older app versions so every rule is deletable.
    fn clear_builtin_flags(&mut self) -> AppResult<()> {
        let mut changed = false;
        for entry in &mut self.index.entries {
            if entry.builtin {
                entry.builtin = false;
                changed = true;
            }
        }
        if changed {
            self.persist_index()?;
        }
        Ok(())
    }

    /// Remove rule packs that older app versions shipped as defaults.
    fn purge_legacy_default_rules(&mut self) -> AppResult<()> {
        const LEGACY_IDS: &[&str] = &[
            "gaosheng-coffee-1.5f",
            "gaosheng-raw-hex",
            "mdb-adapter",
        ];
        for id in LEGACY_IDS {
            if self.index.entries.iter().any(|e| e.id == *id) {
                self.delete(id)?;
            }
        }
        Ok(())
    }

    fn persist_index(&self) -> AppResult<()> {
        let path = self.root.join("index.json");
        fs::write(path, serde_json::to_string_pretty(&self.index)?)?;
        Ok(())
    }

    pub fn list(&self) -> Vec<RuleSummary> {
        self.index
            .entries
            .iter()
            .map(|e| RuleSummary {
                id: e.id.clone(),
                name: e.name.clone(),
                version: e.version.clone(),
                builtin: false,
                active: e.id == self.index.active_id,
            })
            .collect()
    }

    pub fn active_id(&self) -> &str {
        &self.index.active_id
    }

    pub fn has_active(&self) -> bool {
        !self.index.active_id.is_empty()
            && self
                .index
                .entries
                .iter()
                .any(|e| e.id == self.index.active_id)
    }

    pub fn set_active(&mut self, id: &str) -> AppResult<()> {
        if !self.index.entries.iter().any(|e| e.id == id) {
            return Err(AppError::msg("规则不存在"));
        }
        self.index.active_id = id.to_string();
        self.persist_index()
    }

    /// Returns true when the active rule changed (caller should recompile or clear).
    pub fn delete(&mut self, id: &str) -> AppResult<bool> {
        let idx = self
            .index
            .entries
            .iter()
            .position(|e| e.id == id)
            .ok_or_else(|| AppError::msg("规则不存在"))?;
        let entry = &self.index.entries[idx];
        let file = entry.file.clone();
        let was_active = entry.id == self.index.active_id;
        self.index.entries.remove(idx);
        let path = self.root.join(&file);
        if path.exists() {
            fs::remove_file(&path)?;
        }
        if was_active {
            self.index.active_id = self
                .index
                .entries
                .first()
                .map(|e| e.id.clone())
                .unwrap_or_default();
        }
        self.persist_index()?;
        Ok(was_active)
    }

    pub fn active_pack(&self) -> AppResult<RulePack> {
        if self.index.active_id.is_empty() {
            return Err(AppError::msg("无活动规则"));
        }
        self.load_pack(&self.index.active_id)
    }

    pub fn load_pack(&self, id: &str) -> AppResult<RulePack> {
        let entry = self
            .index
            .entries
            .iter()
            .find(|e| e.id == id)
            .ok_or_else(|| AppError::msg("规则不存在"))?;
        let blob = fs::read(self.root.join(&entry.file))?;
        let plain = decrypt_with_key(&blob, &self.key)?;
        let text = String::from_utf8(plain).map_err(|_| AppError::msg("规则不是合法 UTF-8"))?;
        parse_rulepack_json(&text)
    }

    pub fn export_active(&self, passphrase: &str) -> AppResult<Vec<u8>> {
        let pack = self.active_pack()?;
        let json = pack_to_pretty_json(&pack)?;
        encrypt_with_passphrase(json.as_bytes(), passphrase)
    }

    pub fn import_lvrule(&mut self, blob: &[u8], passphrase: &str) -> AppResult<RuleSummary> {
        let plain = decrypt_with_passphrase(blob, passphrase)?;
        let text = String::from_utf8(plain).map_err(|_| AppError::msg("无法解密"))?;
        self.import_json(&text)
    }

    pub fn import_json(&mut self, json: &str) -> AppResult<RuleSummary> {
        let pack = parse_rulepack_json(json)?;
        let file = format!("{}.bin", pack.id);
        let enc = encrypt_with_key(json.as_bytes(), &self.key)?;
        fs::write(self.root.join(&file), enc)?;
        if let Some(existing) = self.index.entries.iter_mut().find(|e| e.id == pack.id) {
            existing.name = pack.name.clone();
            existing.version = pack.version.clone();
            existing.file = file;
            existing.builtin = false;
        } else {
            self.index.entries.push(IndexEntry {
                id: pack.id.clone(),
                name: pack.name.clone(),
                version: pack.version.clone(),
                builtin: false,
                file,
            });
        }
        self.index.active_id = pack.id.clone();
        self.persist_index()?;
        Ok(RuleSummary {
            id: pack.id,
            name: pack.name,
            version: pack.version,
            builtin: false,
            active: true,
        })
    }
}

fn load_or_create_key() -> AppResult<[u8; KEY_LEN]> {
    if let Ok(entry) = Entry::new(SERVICE, KEY_USER) {
        match entry.get_password() {
            Ok(pw) => return decode_key_hex(&pw),
            Err(_) => {
                let key = fresh_key();
                if entry.set_password(&hex::encode(key)).is_ok() {
                    return Ok(key);
                }
            }
        }
    }
    // Fallback when OS keyring is unavailable: local key file with restrictive ACL best-effort
    let fallback = dirs_fallback_path()?;
    if fallback.exists() {
        let pw = fs::read_to_string(&fallback)?;
        return decode_key_hex(pw.trim());
    }
    let key = fresh_key();
    if let Some(parent) = fallback.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&fallback, hex::encode(key))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&fallback, fs::Permissions::from_mode(0o600));
    }
    Ok(key)
}

fn fresh_key() -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    rand::thread_rng().fill_bytes(&mut key);
    key
}

fn decode_key_hex(pw: &str) -> AppResult<[u8; KEY_LEN]> {
    let bytes = hex::decode(pw).map_err(|_| AppError::msg("库密钥损坏"))?;
    if bytes.len() != KEY_LEN {
        return Err(AppError::msg("库密钥长度无效"));
    }
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&bytes);
    Ok(key)
}

fn dirs_fallback_path() -> AppResult<PathBuf> {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .ok_or_else(|| AppError::msg("无法确定配置目录"))?;
    Ok(base.join("com.chyi.log.viewer").join("library.key"))
}
