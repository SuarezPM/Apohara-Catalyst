//! Hook script installer per spec §3.5.
//!
//! Mirrors `src/core/hooks/installer.ts`. Properties preserved:
//!
//! - Idempotent: skips write when the on-disk hash matches the desired
//!   content (SHA-256 over the raw bytes).
//! - Atomic: new content is written to a sibling temp file in the same
//!   directory and renamed into place, so a crash mid-write cannot leave
//!   a partial script.
//! - Backup-before-overwrite: when overwriting differing content, the
//!   existing file is renamed to `<name>.bak.<unix_millis>` BEFORE the
//!   new content lands. If the atomic write fails, the backup is rolled
//!   back to the original path.
//! - chmod 0755 on POSIX for `.sh` files so the CLI can exec them.
//!   Skipped on Windows.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstallReason {
    WroteNew,
    OverwroteWithBackup,
    SkippedHashMatch,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InstallResult {
    pub installed: bool,
    pub reason: InstallReason,
    #[serde(default, rename = "backupPath", skip_serializing_if = "Option::is_none")]
    pub backup_path: Option<PathBuf>,
}

/// Hex-encoded SHA-256 of the input bytes. Matches the TS
/// `computeHookHash(content)` helper.
pub fn compute_hook_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hex::encode(hasher.finalize())
}

/// Install `script_content` into `target_path` per the installer
/// contract. Returns a structured outcome so callers can log without
/// re-stat'ing the file.
pub fn install_hook(target_path: &Path, script_content: &str) -> std::io::Result<InstallResult> {
    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let existing = match std::fs::read_to_string(target_path) {
        Ok(s) => Some(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e),
    };

    if let Some(existing) = existing {
        if compute_hook_hash(&existing) == compute_hook_hash(script_content) {
            return Ok(InstallResult {
                installed: false,
                reason: InstallReason::SkippedHashMatch,
                backup_path: None,
            });
        }

        // Move existing aside FIRST so a backup is always on disk even
        // if the atomic write fails partway through.
        let backup_path = backup_path_for(target_path);
        std::fs::rename(target_path, &backup_path)?;
        match atomic_write(target_path, script_content.as_bytes()) {
            Ok(()) => {
                maybe_chmod_executable(target_path);
                Ok(InstallResult {
                    installed: true,
                    reason: InstallReason::OverwroteWithBackup,
                    backup_path: Some(backup_path),
                })
            }
            Err(e) => {
                // Restore the backup so the user keeps the original.
                let _ = std::fs::rename(&backup_path, target_path);
                Err(e)
            }
        }
    } else {
        atomic_write(target_path, script_content.as_bytes())?;
        maybe_chmod_executable(target_path);
        Ok(InstallResult {
            installed: true,
            reason: InstallReason::WroteNew,
            backup_path: None,
        })
    }
}

fn backup_path_for(target_path: &Path) -> PathBuf {
    let parent = target_path.parent().unwrap_or_else(|| Path::new("."));
    let name = target_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    parent.join(format!("{name}.bak.{ts}"))
}

fn atomic_write(final_path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = final_path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "final_path must have a parent",
        )
    })?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(bytes)?;
    tmp.as_file_mut().sync_all()?;
    tmp.persist(final_path)
        .map_err(|e| std::io::Error::other(e.error))?;
    Ok(())
}

#[cfg(unix)]
fn maybe_chmod_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e == "sh")
        .unwrap_or(false)
    {
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755));
    }
}

#[cfg(not(unix))]
fn maybe_chmod_executable(_path: &Path) {
    // Windows: nothing to do.
}
