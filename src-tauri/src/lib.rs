pub mod commands;
pub mod crypto;
pub mod document;
pub mod error;
pub mod file_assoc;
pub mod launch;
mod library;
pub mod mcp;
pub mod rules;

use commands::{
    decrypt_rule_file, delete_rule, encrypt_rule_json, export_rule, import_rule, list_rules,
    open_document, parse_text, parse_window, read_binary_file, save_document, set_active_rule,
    take_launch_files, write_binary_file, AppState, LaunchFiles,
};
use launch::{dedupe_paths, parse_launch_args, LaunchAction};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::RunEvent;

fn focus_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn queue_or_emit_files(app: &AppHandle, paths: Vec<String>) {
    let paths = dedupe_paths(paths);
    if paths.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<LaunchFiles>() {
        let mut pending = match state.pending.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        if !state.frontend_ready.load(std::sync::atomic::Ordering::SeqCst) {
            for p in paths {
                if !pending.contains(&p) {
                    pending.push(p);
                }
            }
            return;
        }
    }
    focus_main(app);
    let _ = app.emit("open-files", paths);
}

fn paths_from_argv(argv: &[String]) -> Vec<String> {
    match parse_launch_args(argv) {
        LaunchAction::Run { files } => files,
        _ => Vec::new(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // argv[0] is the executable path; remaining args match shell open.
            let args: Vec<String> = argv.into_iter().skip(1).collect();
            let files = paths_from_argv(&args);
            queue_or_emit_files(app, files);
            focus_main(app);
        }))
        .setup(|app| {
            let state = commands::init_state(app.handle())?;
            app.manage(state);

            let argv: Vec<String> = std::env::args().skip(1).collect();
            let initial = paths_from_argv(&argv);
            app.manage(LaunchFiles {
                pending: Mutex::new(initial),
                frontend_ready: std::sync::atomic::AtomicBool::new(false),
            });

            // Refresh Open With registration for the current binary (Windows / Linux user).
            let _ = file_assoc::register();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_document,
            save_document,
            list_rules,
            set_active_rule,
            delete_rule,
            parse_text,
            parse_window,
            export_rule,
            import_rule,
            encrypt_rule_json,
            decrypt_rule_file,
            write_binary_file,
            read_binary_file,
            take_launch_files
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building LogViewer");

    app.run(|app_handle, event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            if let RunEvent::Opened { urls } = &event {
                let mut paths = Vec::new();
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        paths.push(path.to_string_lossy().into_owned());
                    }
                }
                queue_or_emit_files(app_handle, paths);
            }
        }
        #[cfg(not(any(target_os = "macos", target_os = "ios")))]
        {
            let _ = (app_handle, event);
        }
    });
}

// silence unused import in lib when only used via manage type name
#[allow(dead_code)]
fn _state_type(_: &AppState) {}
