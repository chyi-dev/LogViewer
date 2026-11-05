//! LogViewer MCP server (stdio, newline-delimited JSON-RPC 2.0).
//!
//! Build: `cargo build --bin log-viewer-mcp`
//! Configure Cursor via `.cursor/mcp.json`.

use log_viewer_lib::mcp;
use std::io::{self, BufRead, Write};

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!("log-viewer-mcp: read error: {e}");
                break;
            }
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(resp) = mcp::handle_message(trimmed) {
            if let Err(e) = writeln!(stdout, "{resp}") {
                eprintln!("log-viewer-mcp: write error: {e}");
                break;
            }
            let _ = stdout.flush();
        }
    }
}
