//! Cross-platform service installer per spec §0.20.
//!
//! Generates the right service file per platform:
//! - Linux: systemd USER unit at `~/.config/systemd/user/<name>.service`
//! - macOS: launchd plist at `~/Library/LaunchAgents/<label>.plist`
//! - Windows: schtasks /SC ONLOGON command
//!
//! USER-LEVEL ONLY — never system daemons.

use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PersistenceError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("no home dir")]
    NoHomeDir,
    #[error("unsupported platform")]
    UnsupportedPlatform,
}

pub fn build_systemd_user_unit(name: &str, exec_start: &str) -> String {
    format!(
        r#"[Unit]
Description=Apohara — {name}
After=network.target

[Service]
Type=simple
ExecStart={exec_start}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
"#
    )
}

pub fn build_launchd_plist(label: &str, args: &[&str]) -> String {
    let args_xml = args
        .iter()
        .map(|a| format!("        <string>{}</string>", a))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{label}</string>
    <key>ProgramArguments</key>
    <array>
{args_xml}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
"#
    )
}

pub fn build_windows_schtasks(task_name: &str, exec: &str) -> String {
    format!(r#"schtasks /Create /TN "{task_name}" /TR "{exec}" /SC ONLOGON /RL HIGHEST /F"#)
}

pub fn systemd_unit_path(name: &str) -> Result<PathBuf, PersistenceError> {
    let home = dirs::home_dir().ok_or(PersistenceError::NoHomeDir)?;
    Ok(home
        .join(".config/systemd/user")
        .join(format!("{name}.service")))
}

pub fn launchd_plist_path(label: &str) -> Result<PathBuf, PersistenceError> {
    let home = dirs::home_dir().ok_or(PersistenceError::NoHomeDir)?;
    Ok(home
        .join("Library/LaunchAgents")
        .join(format!("{label}.plist")))
}
