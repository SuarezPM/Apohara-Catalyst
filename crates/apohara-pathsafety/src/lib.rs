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
//!
//! G5.G.3 — completed symlink-escape coverage:
//! - relative symlinks (`ln -s ../../outside evil`)
//! - dangling symlinks (target does not exist)
//! - recursive symlink chains (depth-bounded; rejected past `MAX_SYMLINK_HOPS`)
//! - parent-directory escapes via `..` segments
//! - symlinks that loop back to themselves (`Too many levels of symbolic links`)

use std::path::{Component, Path, PathBuf};
use thiserror::Error;

/// Maximum symlink hops before we declare a loop / hostile chain.
/// Same constant Linux uses for ELOOP (`MAXSYMLINKS == 40` historically);
/// we keep it at 32 to match POSIX min and most BSDs.
pub const MAX_SYMLINK_HOPS: u32 = 32;

#[derive(Debug, Error)]
pub enum PathSafetyError {
    #[error("path escapes workspace root: canonical={canonical:?} root={root:?}")]
    EscapesRoot { canonical: PathBuf, root: PathBuf },

    #[error("symlink escapes workspace root: surface={surface:?} target={target:?}")]
    SymlinkEscape { surface: PathBuf, target: PathBuf },

    #[error("symlink chain exceeds {MAX_SYMLINK_HOPS} hops (possible loop): {path:?}")]
    SymlinkLoop { path: PathBuf },

    #[error("dangling symlink: {path:?} → {target:?} (target does not exist)")]
    DanglingSymlink { path: PathBuf, target: PathBuf },

    #[error("path traversal via '..' detected: {0:?}")]
    ParentTraversal(PathBuf),

    #[error("invalid chars in identifier: {0}")]
    InvalidCharsInIdentifier(String),

    #[error("path equals root (not a sub-path)")]
    EqualToRoot,

    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

/// Canonicalize a path, resolving symlinks recursively up to `max_depth`
/// hops. Returns an error if:
///   - canonicalization itself fails (broken/dangling symlinks)
///   - the chain exceeds `max_depth` (loop / hostile)
///
/// `std::fs::canonicalize` does not let us cap hops — but we can compose
/// it with a pre-walk that follows `read_link` one hop at a time and
/// counts. If any hop fails because the target doesn't exist, we map
/// the underlying `io::Error` to `DanglingSymlink` so the caller can
/// distinguish "broken config" from "attack".
pub fn canonicalize_recursive(path: &Path, max_depth: u32) -> Result<PathBuf, PathSafetyError> {
    // First, walk symlinks one hop at a time so we can detect loops and
    // dangling targets explicitly. `std::fs::canonicalize` is the
    // workhorse that resolves everything in one go, but its error is
    // opaque (io::Error::NotFound for both "no such file" and "dangling
    // symlink"). The hop-by-hop pre-walk lets us produce a richer error.
    let mut current = path.to_path_buf();
    let mut hops: u32 = 0;
    loop {
        let meta = match std::fs::symlink_metadata(&current) {
            Ok(m) => m,
            Err(e) => {
                // If we got here from a symlink we just read, the
                // target is dangling — surface it as such.
                if hops > 0 {
                    return Err(PathSafetyError::DanglingSymlink {
                        path: path.to_path_buf(),
                        target: current,
                    });
                }
                return Err(PathSafetyError::Io(e));
            }
        };
        if !meta.file_type().is_symlink() {
            break;
        }
        if hops >= max_depth {
            return Err(PathSafetyError::SymlinkLoop {
                path: path.to_path_buf(),
            });
        }
        let target = std::fs::read_link(&current)?;
        // Resolve relative symlink targets against the link's parent dir.
        current = if target.is_absolute() {
            target
        } else {
            current
                .parent()
                .map(|p| p.join(&target))
                .unwrap_or(target)
        };
        hops += 1;
    }

    // Once we know the chain is finite and the tail exists, let the
    // platform do the heavy lifting — `canonicalize` also collapses
    // `..`/`.` segments and resolves any remaining symlinks in
    // intermediate path components.
    Ok(std::fs::canonicalize(path)?)
}

/// True if `p` syntactically contains any `..` component. Useful to
/// reject path-traversal attempts before even hitting the filesystem.
pub fn contains_parent_traversal(p: &Path) -> bool {
    p.components().any(|c| matches!(c, Component::ParentDir))
}

/// Validate `workspace` is a strict sub-path of `workspace_root` after
/// resolving all symlinks. Rejects:
///   - paths equal to the root (must be a sub-path)
///   - paths that escape via symlink chains
///   - paths that contain `..` traversal segments (rejected even if the
///     end result would land back inside the root, because the intent
///     is suspicious enough to bubble up)
///   - dangling/loopy symlink chains (mapped to their dedicated errors)
pub fn validate_cwd(workspace: &Path, workspace_root: &Path) -> Result<(), PathSafetyError> {
    if contains_parent_traversal(workspace) {
        return Err(PathSafetyError::ParentTraversal(workspace.to_path_buf()));
    }
    let canonical_root = canonicalize_recursive(workspace_root, MAX_SYMLINK_HOPS)?;
    let canonical_ws = canonicalize_recursive(workspace, MAX_SYMLINK_HOPS)?;
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

#[cfg(test)]
mod lib_tests {
    use super::*;

    #[test]
    fn contains_parent_traversal_flags_dotdot() {
        assert!(contains_parent_traversal(Path::new("a/../b")));
        assert!(contains_parent_traversal(Path::new("../outside")));
        assert!(!contains_parent_traversal(Path::new("a/b/c")));
        assert!(!contains_parent_traversal(Path::new("./local")));
    }

    #[test]
    fn safe_identifier_idempotent_on_clean_input() {
        let clean = "feature-branch_v1.2";
        assert_eq!(safe_identifier(clean), clean);
    }
}
