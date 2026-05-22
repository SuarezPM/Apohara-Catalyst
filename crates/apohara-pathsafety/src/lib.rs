//! Path safety per spec §3.11.
//!
//! Three invariants every worker MUST satisfy:
//! 1. `cwd == workspace_path` before spawning agent subprocess.
//! 2. `workspace_path` has `workspace_root` as prefix AFTER canonicalization.
//! 3. Workspace directory name uses only `[A-Za-z0-9._-]`; other chars → `_`.
//!
//! Symlink escape detection: "path looks inside root but resolves outside" is
//! a distinct error from "path is literally outside root" — exposes attack
//! attempts vs configuration mistakes.

use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PathSafetyError {
    #[error("path escapes workspace root: canonical={canonical:?} root={root:?}")]
    EscapesRoot { canonical: PathBuf, root: PathBuf },

    #[error("symlink escapes workspace root: surface={surface:?} target={target:?}")]
    SymlinkEscape { surface: PathBuf, target: PathBuf },

    #[error("invalid chars in identifier: {0}")]
    InvalidCharsInIdentifier(String),

    #[error("path equals root (not a sub-path)")]
    EqualToRoot,

    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

/// Canonicalize a path, resolving symlinks recursively. Returns an error if
/// canonicalization itself fails (broken symlinks, etc.).
pub fn canonicalize_recursive(path: &Path, _max_depth: u32) -> Result<PathBuf, PathSafetyError> {
    Ok(std::fs::canonicalize(path)?)
}

/// Validate `workspace` is a strict sub-path of `workspace_root` after
/// resolving all symlinks. Rejects paths equal to the root (must be a sub-path).
pub fn validate_cwd(workspace: &Path, workspace_root: &Path) -> Result<(), PathSafetyError> {
    let canonical_root = canonicalize_recursive(workspace_root, 32)?;
    let canonical_ws = canonicalize_recursive(workspace, 32)?;
    if canonical_ws == canonical_root {
        return Err(PathSafetyError::EqualToRoot);
    }
    if !canonical_ws.starts_with(&canonical_root) {
        // Distinguish symlink escape vs literal outside path: if the surface path
        // is *inside* the root (string-wise) but canonical is *outside*, it was
        // a symlink escape.
        if workspace.starts_with(workspace_root) {
            return Err(PathSafetyError::SymlinkEscape {
                surface: workspace.to_path_buf(),
                target: canonical_ws,
            });
        }
        return Err(PathSafetyError::EscapesRoot {
            canonical: canonical_ws,
            root: canonical_root,
        });
    }
    Ok(())
}

/// Sanitize a string for use as a workspace directory name. Replaces any char
/// not in `[A-Za-z0-9._-]` with `_`.
pub fn safe_identifier(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect()
}
