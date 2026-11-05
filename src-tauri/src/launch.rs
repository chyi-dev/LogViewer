//! Launch argument helpers for opening files from the shell.

/// Extensions we advertise in Open With / file dialogs.
pub const LOG_EXTENSIONS: &[&str] = &["txt", "log", "alog", "xlog", "logs"];

pub const PROG_ID: &str = "LogViewer.LogFile";
pub const FRIENDLY_APP_NAME: &str = "LogViewer";
pub const REGISTER_FLAG: &str = "--register-file-assoc";
pub const UNREGISTER_FLAG: &str = "--unregister-file-assoc";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchAction {
    RegisterAssoc,
    UnregisterAssoc,
    Run { files: Vec<String> },
}

/// Parse argv (without program name). Flags starting with `-` are ignored as paths.
pub fn parse_launch_args(args: &[String]) -> LaunchAction {
    if args.iter().any(|a| a == REGISTER_FLAG) {
        return LaunchAction::RegisterAssoc;
    }
    if args.iter().any(|a| a == UNREGISTER_FLAG) {
        return LaunchAction::UnregisterAssoc;
    }
    let files: Vec<String> = args
        .iter()
        .filter(|a| !a.starts_with('-'))
        .cloned()
        .collect();
    LaunchAction::Run { files }
}

/// Deduplicate paths while preserving order.
pub fn dedupe_paths(paths: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for p in paths {
        if seen.insert(p.clone()) {
            out.push(p);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(args: &[&str]) -> Vec<String> {
        args.iter().map(|a| (*a).to_string()).collect()
    }

    #[test]
    fn parse_register_flag() {
        assert_eq!(
            parse_launch_args(&s(&[REGISTER_FLAG])),
            LaunchAction::RegisterAssoc
        );
        assert_eq!(
            parse_launch_args(&s(&["C:\\a.log", REGISTER_FLAG])),
            LaunchAction::RegisterAssoc
        );
    }

    #[test]
    fn parse_unregister_flag() {
        assert_eq!(
            parse_launch_args(&s(&[UNREGISTER_FLAG])),
            LaunchAction::UnregisterAssoc
        );
    }

    #[test]
    fn parse_file_paths_ignores_flags() {
        assert_eq!(
            parse_launch_args(&s(&["--foo", "C:\\logs\\a.log", "-v", "b.txt"])),
            LaunchAction::Run {
                files: vec!["C:\\logs\\a.log".into(), "b.txt".into()]
            }
        );
    }

    #[test]
    fn parse_empty_is_run_with_no_files() {
        assert_eq!(
            parse_launch_args(&[]),
            LaunchAction::Run { files: vec![] }
        );
    }

    #[test]
    fn dedupe_preserves_order() {
        assert_eq!(
            dedupe_paths(vec![
                "a.log".into(),
                "b.log".into(),
                "a.log".into(),
                "c.log".into()
            ]),
            vec!["a.log", "b.log", "c.log"]
        );
    }

    #[test]
    fn log_extensions_cover_plan() {
        assert!(LOG_EXTENSIONS.contains(&"txt"));
        assert!(LOG_EXTENSIONS.contains(&"log"));
        assert!(LOG_EXTENSIONS.contains(&"alog"));
        assert!(LOG_EXTENSIONS.contains(&"xlog"));
        assert!(LOG_EXTENSIONS.contains(&"logs"));
    }
}
