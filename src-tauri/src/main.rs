// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match log_viewer_lib::launch::parse_launch_args(&args) {
        log_viewer_lib::launch::LaunchAction::RegisterAssoc => {
            if let Err(e) = log_viewer_lib::file_assoc::register() {
                eprintln!("register file associations failed: {e}");
                std::process::exit(1);
            }
            return;
        }
        log_viewer_lib::launch::LaunchAction::UnregisterAssoc => {
            if let Err(e) = log_viewer_lib::file_assoc::unregister() {
                eprintln!("unregister file associations failed: {e}");
                std::process::exit(1);
            }
            return;
        }
        log_viewer_lib::launch::LaunchAction::Run { .. } => {}
    }
    log_viewer_lib::run()
}
