//! Endpoint file per spec §3.5 + atomic-write discipline §0.8.
//!
//! On server start we write `~/.apohara/sockets/hooks-endpoint.json` so
//! hook scripts can discover the loopback `{ port, token, started_at }`
//! across server restarts. Write is **atomic** (NamedTempFile in same
//! parent dir + rename) — partial writes never become visible. File mode
//! is set to `0o600` on the open fd (fchmod-style via `File::set_permissions`)
//! BEFORE the rename so there is no window where the token is world-readable
//! (TOCTOU mitigation — culture inspiration #4).
//!
//! On shutdown the file is best-effort deleted; absence is not an error
//! (the file may have been cleaned externally or never written, e.g. when
//! `HOME` was unset).

use serde::{Deserialize, Serialize};
use std::fs::{File, Permissions};
use std::io::{self, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

/// Loopback endpoint descriptor written to `hooks-endpoint.json`.
///
/// Hook scripts parse this to populate the `Authorization: Bearer …` header
/// and target URL on every event POST.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndpointDescriptor {
    pub port: u16,
    pub token: String,
    pub started_at: i64,
}

/// Atomically write `desc` to `path`, with mode 0600.
///
/// Steps:
/// 1. Ensure parent dir exists (`create_dir_all`).
/// 2. Create a `NamedTempFile` **in the same parent dir** (required so the
///    final rename stays within one filesystem — `rename(2)` across mounts
///    fails with `EXDEV`).
/// 3. Set mode 0600 on the open fd via `File::set_permissions` (fchmod).
///    This happens **before** the rename so the published file is never
///    world-readable.
/// 4. Write the JSON body and `flush`.
/// 5. `persist(path)` performs the atomic rename.
pub fn write_atomic(path: &Path, desc: &EndpointDescriptor) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("endpoint path has no parent: {}", path.display()),
        )
    })?;
    std::fs::create_dir_all(parent)?;

    let body = serde_json::to_vec_pretty(desc).map_err(io::Error::other)?;

    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    set_mode_0600(tmp.as_file())?;
    tmp.write_all(&body)?;
    tmp.flush()?;

    tmp.persist(path).map_err(|e| e.error)?;
    Ok(())
}

/// Delete `path` if it exists. `NotFound` is treated as success.
pub fn delete_if_exists(path: &Path) -> io::Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Resolve `$HOME/.apohara/sockets/hooks-endpoint.json`.
///
/// Errors with `NotFound` if `HOME` is unset (e.g. minimal sandbox
/// environments). Callers in the server should treat this as "skip
/// endpoint-file publishing" rather than a hard failure.
pub fn endpoint_file_path() -> io::Result<PathBuf> {
    let home = std::env::var_os("HOME").ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "HOME environment variable is not set")
    })?;
    Ok(PathBuf::from(home)
        .join(".apohara")
        .join("sockets")
        .join("hooks-endpoint.json"))
}

/// fchmod-style mode set on the open file handle. Avoids the TOCTOU race
/// of `set_permissions(path, …)` which could be intercepted by a symlink
/// swap on the temp path.
fn set_mode_0600(file: &File) -> io::Result<()> {
    file.set_permissions(Permissions::from_mode(0o600))
}
