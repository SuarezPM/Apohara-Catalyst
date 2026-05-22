//! Cross-platform service installer per spec §0.20.
//!
//! Generates the right service file per platform:
//! - Linux: systemd USER unit at `~/.config/systemd/user/<name>.service`
//! - macOS: launchd plist at `~/Library/LaunchAgents/<label>.plist`
//! - Windows: schtasks /SC ONLOGON command
//!
//! USER-LEVEL ONLY — never system daemons.
//!
//! ## Input validation
//!
//! Cross-platform service templates are a juicy injection target: a stray `"`,
//! `&`, `\n`, or `<` in user-controlled input can rewrite a `schtasks` command
//! line, terminate a systemd directive, or inject `<true/>` into a plist. All
//! three builders therefore reject hostile inputs up front via
//! [`PersistenceError::InvalidInput`], or escape them where escaping is
//! unambiguous (XML). See the per-builder docs for the exact contract.

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
    #[error("invalid input for {field}: {reason}")]
    InvalidInput {
        field: &'static str,
        reason: String,
    },
}

/// Minimal XML 1.0 char-data escaper for plist generation.
/// Escapes the five XML predefined entities. Sufficient because plist
/// values land inside text nodes / attribute values; no CDATA mode used.
fn xml_escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Build a USER-LEVEL systemd unit file targeting `default.target`.
///
/// Validates inputs to prevent ExecStart directive injection:
/// - `name` must be non-empty and match `[a-zA-Z0-9_-]+` (systemd unit name rules).
/// - `exec_start` must not contain `\n`/`\r` (silently terminates directives),
///   `%` (systemd specifier), or start with `@`/`-`/`+`/`:`/`!` (prefix
///   specifiers that alter exec semantics).
pub fn build_systemd_user_unit(
    name: &str,
    exec_start: &str,
) -> Result<String, PersistenceError> {
    if name.is_empty() {
        return Err(PersistenceError::InvalidInput {
            field: "name",
            reason: "name must not be empty".to_string(),
        });
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(PersistenceError::InvalidInput {
            field: "name",
            reason: "name must match [a-zA-Z0-9_-]+".to_string(),
        });
    }

    if exec_start.is_empty() {
        return Err(PersistenceError::InvalidInput {
            field: "exec_start",
            reason: "exec_start must not be empty".to_string(),
        });
    }
    if exec_start.contains('\n') || exec_start.contains('\r') {
        return Err(PersistenceError::InvalidInput {
            field: "exec_start",
            reason: "newline characters terminate ExecStart directive".to_string(),
        });
    }
    if exec_start.contains('%') {
        return Err(PersistenceError::InvalidInput {
            field: "exec_start",
            reason: "% is a systemd specifier prefix and is not allowed".to_string(),
        });
    }
    if let Some(first) = exec_start.chars().next() {
        if matches!(first, '@' | '-' | '+' | ':' | '!') {
            return Err(PersistenceError::InvalidInput {
                field: "exec_start",
                reason: format!("leading '{first}' is a systemd prefix specifier"),
            });
        }
    }

    Ok(format!(
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
    ))
}

/// Build a launchd plist for a USER-LEVEL LaunchAgent.
///
/// `label` and every entry in `args` is XML-escaped via [`xml_escape`], which
/// neutralises `<`, `>`, `&`, `"`, `'`. This is the safe escape boundary:
/// callers may pass arbitrary strings without breaking the plist or smuggling
/// in extra plist keys (e.g. `<key>RunAtRoot</key><true/>`).
pub fn build_launchd_plist(label: &str, args: &[&str]) -> String {
    let escaped_label = xml_escape(label);
    let args_xml = args
        .iter()
        .map(|a| format!("        <string>{}</string>", xml_escape(a)))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{escaped_label}</string>
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

/// Build a `schtasks /Create` command for USER-LEVEL ONLOGON registration.
///
/// Validates inputs because cmd.exe quoting CANNOT safely represent these
/// characters once embedded in a `/TR "..."` argument:
/// - control chars (`\0`..`\x1f`)
/// - cmd metacharacters `&`, `|`, `<`, `>`, `^`
/// - `"` (would close the quoted argument; cmd has no general escape)
///
/// Both `task_name` and `exec` are subject to the same restrictions. Callers
/// must sanitize paths/arguments upstream; this builder is the last line of
/// defence, not the first.
pub fn build_windows_schtasks(
    task_name: &str,
    exec: &str,
) -> Result<String, PersistenceError> {
    fn validate(field: &'static str, value: &str) -> Result<(), PersistenceError> {
        if value.is_empty() {
            return Err(PersistenceError::InvalidInput {
                field,
                reason: format!("{field} must not be empty"),
            });
        }
        for ch in value.chars() {
            if (ch as u32) < 0x20 {
                return Err(PersistenceError::InvalidInput {
                    field,
                    reason: format!("{field} must not contain control characters"),
                });
            }
            if matches!(ch, '&' | '|' | '<' | '>' | '^' | '"') {
                return Err(PersistenceError::InvalidInput {
                    field,
                    reason: format!(
                        "{field} must not contain cmd metacharacter or quote ('{ch}')"
                    ),
                });
            }
        }
        Ok(())
    }

    validate("task_name", task_name)?;
    validate("exec", exec)?;

    Ok(format!(
        r#"schtasks /Create /TN "{task_name}" /TR "{exec}" /SC ONLOGON /RL HIGHEST /F"#
    ))
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
