//! Ports `src/core/safety/runnerPolicy/fsSnapshot.ts`. SHA-256 snapshot
//! of protected paths so post-run drift can be detected.

use globset::{Glob, GlobSetBuilder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::fs;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileSnapshot {
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SnapshotResult {
    pub files: Vec<FileSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Violation {
    pub path: String,
    pub before: String,
    pub after: String,
}

/// Walk `workspace` and snapshot every file matching one of the
/// glob `patterns`. Missing files are simply omitted (parity with TS).
pub async fn snapshot_protected_paths(
    workspace: &Path,
    patterns: &[String],
) -> std::io::Result<SnapshotResult> {
    let mut builder = GlobSetBuilder::new();
    for p in patterns {
        match Glob::new(p) {
            Ok(g) => {
                builder.add(g);
            }
            Err(_) => {
                // ignore invalid pattern — parity with TS Glob() that
                // silently no-ops on bad input
            }
        }
    }
    let set = builder.build().map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, e.to_string())
    })?;

    let mut files: Vec<FileSnapshot> = Vec::new();
    let mut stack: Vec<PathBuf> = vec![workspace.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let mut rd = match fs::read_dir(&dir).await {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        while let Ok(Some(entry)) = rd.next_entry().await {
            let path = entry.path();
            let Ok(rel) = path.strip_prefix(workspace) else {
                continue;
            };
            let file_type = match entry.file_type().await {
                Ok(ft) => ft,
                Err(_) => continue,
            };
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if !set.is_match(rel) {
                continue;
            }
            let content = match fs::read(&path).await {
                Ok(c) => c,
                Err(_) => continue,
            };
            let mut hasher = Sha256::new();
            hasher.update(&content);
            let digest = hasher.finalize();
            files.push(FileSnapshot {
                path: rel.to_string_lossy().to_string(),
                sha256: hex::encode(digest),
                size: content.len() as u64,
            });
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(SnapshotResult { files })
}

/// Re-hash every snapshotted file and emit a `Violation` row for each
/// that changed (or was deleted between snapshot and check).
pub async fn detect_violations(
    before: &SnapshotResult,
    workspace: &Path,
) -> std::io::Result<Vec<Violation>> {
    let mut violations = Vec::new();
    for snap in &before.files {
        let full = workspace.join(&snap.path);
        match fs::read(&full).await {
            Ok(content) => {
                let mut hasher = Sha256::new();
                hasher.update(&content);
                let after = hex::encode(hasher.finalize());
                if after != snap.sha256 {
                    violations.push(Violation {
                        path: snap.path.clone(),
                        before: snap.sha256.clone(),
                        after,
                    });
                }
            }
            Err(_) => {
                violations.push(Violation {
                    path: snap.path.clone(),
                    before: snap.sha256.clone(),
                    after: "<deleted>".to_string(),
                });
            }
        }
    }
    Ok(violations)
}
