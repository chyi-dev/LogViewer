use crate::crypto::{decrypt_rulepack_blob, encrypt_rulepack_json};
use crate::document::{self, LineEnding, OpenedDocument};
use crate::error::AppResult;
use crate::library::{RuleLibrary, RuleSummary};
use crate::rules::engine::{parse_document, parse_lines, CompiledPack, ParseEvent};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct AppState {
    pub library: Mutex<RuleLibrary>,
    pub compiled: Mutex<Option<CompiledPack>>,
}

/// Files requested by the OS before / until the frontend is ready to receive them.
pub struct LaunchFiles {
    pub pending: Mutex<Vec<String>>,
    pub frontend_ready: AtomicBool,
}

#[derive(Serialize)]
pub struct ParseResponse {
    pub events: Vec<ParseEvent>,
    pub rule_name: String,
    pub rule_id: String,
}

#[tauri::command]
pub fn open_document(path: String) -> AppResult<OpenedDocument> {
    document::open_path(PathBuf::from(path).as_path())
}

/// Drain launch / Open With paths once the UI is listening for `open-files`.
#[tauri::command]
pub fn take_launch_files(state: State<'_, LaunchFiles>) -> Vec<String> {
    state.frontend_ready.store(true, Ordering::SeqCst);
    state
        .pending
        .lock()
        .map(|mut g| std::mem::take(&mut *g))
        .unwrap_or_default()
}

#[tauri::command]
pub fn save_document(
    path: String,
    text: String,
    encoding: String,
    line_ending: LineEnding,
) -> AppResult<()> {
    document::save_path(PathBuf::from(path).as_path(), &text, &encoding, line_ending)
}

#[tauri::command]
pub fn list_rules(state: State<'_, AppState>) -> AppResult<Vec<RuleSummary>> {
    let lib = state.library.lock().map_err(|_| crate::error::AppError::msg("状态锁失败"))?;
    Ok(lib.list())
}

#[tauri::command]
pub fn set_active_rule(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let mut lib = state.library.lock().map_err(|_| crate::error::AppError::msg("状态锁失败"))?;
    lib.set_active(&id)?;
    let pack = lib.active_pack()?;
    let compiled = CompiledPack::compile(pack)?;
    let mut c = state
        .compiled
        .lock()
        .map_err(|_| crate::error::AppError::msg("状态锁失败"))?;
    *c = Some(compiled);
    Ok(())
}

#[tauri::command]
pub fn delete_rule(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let mut lib = state.library.lock().map_err(|_| crate::error::AppError::msg("状态锁失败"))?;
    let active_changed = lib.delete(&id)?;
    if active_changed {
        let next = if lib.has_active() {
            let pack = lib.active_pack()?;
            Some(CompiledPack::compile(pack)?)
        } else {
            None
        };
        drop(lib);
        let mut c = state
            .compiled
            .lock()
            .map_err(|_| crate::error::AppError::msg("状态锁失败"))?;
        *c = next;
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct ParseLineInput {
    pub line: usize,
    pub text: String,
}

fn active_rule_meta(lib: &RuleLibrary) -> (String, String) {
    lib.list()
        .into_iter()
        .find(|r| r.active)
        .map(|r| (r.name, r.id))
        .unwrap_or_default()
}

#[tauri::command]
pub fn parse_text(state: State<'_, AppState>, text: String) -> AppResult<ParseResponse> {
    let lib = state.library.lock().map_err(|_| crate::error::AppError::msg("状态锁失败"))?;
    let (rule_name, rule_id) = active_rule_meta(&lib);
    let compiled = state
        .compiled
        .lock()
        .map_err(|_| crate::error::AppError::msg("状态锁失败"))?;
    let events = compiled
        .as_ref()
        .map(|c| parse_document(c, &text))
        .unwrap_or_default();
    Ok(ParseResponse {
        events,
        rule_name,
        rule_id,
    })
}

#[tauri::command]
pub fn parse_window(
    state: State<'_, AppState>,
    lines: Vec<ParseLineInput>,
) -> AppResult<ParseResponse> {
    let lib = state.library.lock().map_err(|_| crate::error::AppError::msg("状态锁失败"))?;
    let (rule_name, rule_id) = active_rule_meta(&lib);
    let compiled = state
        .compiled
        .lock()
        .map_err(|_| crate::error::AppError::msg("状态锁失败"))?;
    let events = if let Some(c) = compiled.as_ref() {
        let refs: Vec<(usize, &str)> = lines
            .iter()
            .map(|l| (l.line, l.text.as_str()))
            .collect();
        parse_lines(c, &refs)
    } else {
        Vec::new()
    };
    Ok(ParseResponse {
        events,
        rule_name,
        rule_id,
    })
}

#[tauri::command]
pub fn export_rule(state: State<'_, AppState>, passphrase: String) -> AppResult<Vec<u8>> {
    let lib = state.library.lock().map_err(|_| crate::error::AppError::msg("状态锁失败"))?;
    lib.export_active(&passphrase)
}

#[tauri::command]
pub fn import_rule(
    state: State<'_, AppState>,
    data: Vec<u8>,
    passphrase: String,
) -> AppResult<RuleSummary> {
    let mut lib = state.library.lock().map_err(|_| crate::error::AppError::msg("状态锁失败"))?;
    let summary = lib.import_lvrule(&data, &passphrase)?;
    let pack = lib.active_pack()?;
    let compiled = CompiledPack::compile(pack)?;
    drop(lib);
    let mut c = state
        .compiled
        .lock()
        .map_err(|_| crate::error::AppError::msg("状态锁失败"))?;
    *c = Some(compiled);
    Ok(summary)
}

#[tauri::command]
pub fn encrypt_rule_json(json: String, passphrase: String) -> AppResult<Vec<u8>> {
    encrypt_rulepack_json(&json, &passphrase)
}

#[tauri::command]
pub fn decrypt_rule_file(data: Vec<u8>, passphrase: String) -> AppResult<String> {
    decrypt_rulepack_blob(&data, &passphrase)
}

#[tauri::command]
pub fn write_binary_file(path: String, data: Vec<u8>) -> AppResult<()> {
    if let Some(parent) = PathBuf::from(&path).parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, data)?;
    Ok(())
}

#[tauri::command]
pub fn read_binary_file(path: String) -> AppResult<Vec<u8>> {
    Ok(std::fs::read(path)?)
}

/// Sibling of the running app binary: `log-viewer-mcp` / `log-viewer-mcp.exe`.
#[tauri::command]
pub fn mcp_server_path() -> String {
    let exe = std::env::current_exe().unwrap_or_default();
    let dir = exe.parent().map(PathBuf::from).unwrap_or_default();
    let name = if cfg!(windows) {
        "log-viewer-mcp.exe"
    } else {
        "log-viewer-mcp"
    };
    dir.join(name).to_string_lossy().into_owned()
}

pub fn init_state(app: &AppHandle) -> AppResult<AppState> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| crate::error::AppError::msg(e.to_string()))?;
    std::fs::create_dir_all(&data_dir)?;
    let library = RuleLibrary::open(&data_dir)?;
    let compiled = if library.has_active() {
        let pack = library.active_pack()?;
        Some(CompiledPack::compile(pack)?)
    } else {
        None
    };
    Ok(AppState {
        library: Mutex::new(library),
        compiled: Mutex::new(compiled),
    })
}
