//! Register LogViewer as an Open With candidate without stealing defaults.

use crate::launch::{FRIENDLY_APP_NAME, LOG_EXTENSIONS, PROG_ID};

#[derive(Debug, thiserror::Error)]
pub enum AssocError {
    #[error("{0}")]
    Msg(String),
}

impl AssocError {
    fn msg(s: impl Into<String>) -> Self {
        Self::Msg(s.into())
    }
}

pub type AssocResult<T = ()> = Result<T, AssocError>;

/// Register or refresh associations for the current executable.
pub fn register() -> AssocResult {
    #[cfg(windows)]
    {
        windows::register()
    }
    #[cfg(target_os = "linux")]
    {
        linux::register()
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        Ok(())
    }
}

/// Remove associations written by this app.
pub fn unregister() -> AssocResult {
    #[cfg(windows)]
    {
        windows::unregister()
    }
    #[cfg(target_os = "linux")]
    {
        linux::unregister()
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        Ok(())
    }
}

/// Shared MIME package XML for Linux custom log extensions.
pub fn mime_package_xml() -> String {
    r#"<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="text/x-log">
    <comment>Log file</comment>
    <glob pattern="*.log"/>
  </mime-type>
  <mime-type type="application/x-logviewer-alog">
    <comment>LogViewer alog</comment>
    <glob pattern="*.alog"/>
  </mime-type>
  <mime-type type="application/x-logviewer-xlog">
    <comment>LogViewer xlog</comment>
    <glob pattern="*.xlog"/>
  </mime-type>
  <mime-type type="application/x-logviewer-logs">
    <comment>LogViewer logs</comment>
    <glob pattern="*.logs"/>
  </mime-type>
</mime-info>
"#
    .to_string()
}

/// Desktop entry body for a given Exec line (absolute path or binary name).
pub fn desktop_entry(exec: &str) -> String {
    let mime = [
        "text/plain",
        "text/x-log",
        "application/x-logviewer-alog",
        "application/x-logviewer-xlog",
        "application/x-logviewer-logs",
    ]
    .join(";");
    format!(
        "[Desktop Entry]\n\
Categories=Utility;Development;\n\
Comment=Log viewer\n\
Exec={exec} %f\n\
StartupWMClass={FRIENDLY_APP_NAME}\n\
Icon=log-viewer\n\
Name={FRIENDLY_APP_NAME}\n\
Terminal=false\n\
Type=Application\n\
MimeType={mime};\n"
    )
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::path::PathBuf;
    use winreg::enums::*;
    use winreg::RegKey;

    fn exe_path() -> AssocResult<PathBuf> {
        std::env::current_exe().map_err(|e| AssocError::msg(e.to_string()))
    }

    fn exe_name(path: &std::path::Path) -> AssocResult<String> {
        path.file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
            .ok_or_else(|| AssocError::msg("无法解析可执行文件名"))
    }

    fn open_command(exe: &std::path::Path) -> String {
        format!("\"{}\" \"%1\"", exe.display())
    }

    fn notify_shell() {
        #[link(name = "shell32")]
        extern "system" {
            fn SHChangeNotify(event: i32, flags: u32, item1: isize, item2: isize);
        }
        const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
        const SHCNF_IDLIST: u32 = 0x0000;
        unsafe {
            SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0);
        }
    }

    pub fn register() -> AssocResult {
        let exe = exe_path()?;
        let name = exe_name(&exe)?;
        let cmd = open_command(&exe);
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        let app_key = format!(r"Software\Classes\Applications\{name}");
        let (app, _) = hkcu
            .create_subkey(&app_key)
            .map_err(|e| AssocError::msg(e.to_string()))?;
        app.set_value("FriendlyAppName", &FRIENDLY_APP_NAME)
            .map_err(|e| AssocError::msg(e.to_string()))?;
        let (shell_open, _) = app
            .create_subkey(r"shell\open\command")
            .map_err(|e| AssocError::msg(e.to_string()))?;
        shell_open
            .set_value("", &cmd)
            .map_err(|e| AssocError::msg(e.to_string()))?;

        let (supported, _) = app
            .create_subkey("SupportedTypes")
            .map_err(|e| AssocError::msg(e.to_string()))?;
        for ext in LOG_EXTENSIONS {
            supported
                .set_value(format!(".{ext}"), &"")
                .map_err(|e| AssocError::msg(e.to_string()))?;
        }

        let prog = format!(r"Software\Classes\{PROG_ID}");
        let (prog_key, _) = hkcu
            .create_subkey(&prog)
            .map_err(|e| AssocError::msg(e.to_string()))?;
        prog_key
            .set_value("", &"LogViewer Log File")
            .map_err(|e| AssocError::msg(e.to_string()))?;
        let (prog_cmd, _) = prog_key
            .create_subkey(r"shell\open\command")
            .map_err(|e| AssocError::msg(e.to_string()))?;
        prog_cmd
            .set_value("", &cmd)
            .map_err(|e| AssocError::msg(e.to_string()))?;

        for ext in LOG_EXTENSIONS {
            let base = format!(r"Software\Classes\.{ext}");
            let (owp, _) = hkcu
                .create_subkey(format!(r"{base}\OpenWithProgids"))
                .map_err(|e| AssocError::msg(e.to_string()))?;
            owp.set_value(PROG_ID, &"")
                .map_err(|e| AssocError::msg(e.to_string()))?;

            let (owl, _) = hkcu
                .create_subkey(format!(r"{base}\OpenWithList\{name}"))
                .map_err(|e| AssocError::msg(e.to_string()))?;
            let _ = owl;
        }

        notify_shell();
        Ok(())
    }

    pub fn unregister() -> AssocResult {
        let exe = exe_path()?;
        let name = exe_name(&exe)?;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        let _ = hkcu.delete_subkey_all(format!(r"Software\Classes\Applications\{name}"));
        let _ = hkcu.delete_subkey_all(format!(r"Software\Classes\{PROG_ID}"));

        for ext in LOG_EXTENSIONS {
            let base = format!(r"Software\Classes\.{ext}");
            if let Ok(owp) = hkcu.open_subkey_with_flags(
                format!(r"{base}\OpenWithProgids"),
                KEY_SET_VALUE,
            ) {
                let _ = owp.delete_value(PROG_ID);
            }
            let _ = hkcu.delete_subkey_all(format!(r"{base}\OpenWithList\{name}"));
        }

        notify_shell();
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    const DESKTOP_ID: &str = "com.chyi.log.viewer.desktop";
    const MIME_PACKAGE: &str = "log-viewer.xml";

    fn exe_path() -> AssocResult<PathBuf> {
        if let Ok(appimage) = std::env::var("APPIMAGE") {
            if !appimage.is_empty() {
                return Ok(PathBuf::from(appimage));
            }
        }
        std::env::current_exe().map_err(|e| AssocError::msg(e.to_string()))
    }

    fn should_write_user_entries(exe: &Path) -> bool {
        if std::env::var_os("APPIMAGE").is_some() {
            return true;
        }
        !exe.starts_with("/usr")
    }

    fn xdg_data_home() -> PathBuf {
        if let Ok(p) = std::env::var("XDG_DATA_HOME") {
            if !p.is_empty() {
                return PathBuf::from(p);
            }
        }
        dirs_fallback_home().join(".local/share")
    }

    fn dirs_fallback_home() -> PathBuf {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    }

    fn run_update(bin: &str, dir: &Path) {
        let _ = Command::new(bin).arg(dir).status();
    }

    pub fn register() -> AssocResult {
        let exe = exe_path()?;
        if !should_write_user_entries(&exe) {
            return Ok(());
        }
        let data = xdg_data_home();
        let apps = data.join("applications");
        let mime_pkg = data.join("mime/packages");
        std::fs::create_dir_all(&apps).map_err(|e| AssocError::msg(e.to_string()))?;
        std::fs::create_dir_all(&mime_pkg).map_err(|e| AssocError::msg(e.to_string()))?;

        let exec = format!("\"{}\"", exe.display());
        std::fs::write(apps.join(DESKTOP_ID), desktop_entry(&exec))
            .map_err(|e| AssocError::msg(e.to_string()))?;
        std::fs::write(mime_pkg.join(MIME_PACKAGE), mime_package_xml())
            .map_err(|e| AssocError::msg(e.to_string()))?;

        run_update("update-desktop-database", &apps);
        run_update("update-mime-database", &data.join("mime"));
        Ok(())
    }

    pub fn unregister() -> AssocResult {
        let data = xdg_data_home();
        let apps = data.join("applications");
        let mime_pkg = data.join("mime/packages");
        let _ = std::fs::remove_file(apps.join(DESKTOP_ID));
        let _ = std::fs::remove_file(mime_pkg.join(MIME_PACKAGE));
        run_update("update-desktop-database", &apps);
        run_update("update-mime-database", &data.join("mime"));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mime_xml_covers_custom_extensions() {
        let xml = mime_package_xml();
        assert!(xml.contains("*.alog"));
        assert!(xml.contains("*.xlog"));
        assert!(xml.contains("*.logs"));
        assert!(xml.contains("*.log"));
        assert!(!xml.contains("*.txt"));
    }

    #[test]
    fn desktop_entry_lists_mime_and_file_arg() {
        let d = desktop_entry("/opt/LogViewer/log-viewer");
        assert!(d.contains("Exec=/opt/LogViewer/log-viewer %f"));
        assert!(d.contains("text/plain"));
        assert!(d.contains("application/x-logviewer-alog"));
        assert!(d.contains("MimeType="));
    }
}
