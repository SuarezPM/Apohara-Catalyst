//! Permission pattern matcher — ports `src/core/safety/patterns.ts`.
//!
//! Grammar mirrors the Claude CLI's official pattern syntax:
//!   Bash(npm test:*)     -> BashPrefix("npm test")
//!   WebFetch(domain:X)   -> WebFetchDomain("X")
//!   Edit(glob)           -> EditGlob("glob")
//!   mcp__server__*       -> McpPrefix("mcp__server__")

use globset::{Glob, GlobMatcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Component, PathBuf};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PermissionPattern {
    BashPrefix { prefix: String },
    WebFetchDomain { domain: String },
    EditGlob { glob: String },
    McpPrefix { prefix: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInvocation {
    pub tool: String,
    /// Free-form JSON map matching the TS `Record<string, unknown>`.
    pub input: HashMap<String, serde_json::Value>,
}

impl ToolInvocation {
    pub fn new(tool: impl Into<String>) -> Self {
        Self {
            tool: tool.into(),
            input: HashMap::new(),
        }
    }

    pub fn with_input(mut self, key: &str, value: serde_json::Value) -> Self {
        self.input.insert(key.to_string(), value);
        self
    }

    fn string_field(&self, key: &str) -> Option<&str> {
        self.input.get(key).and_then(|v| v.as_str())
    }
}

/// Match `inv` against `pattern`. Returns true iff the invocation is
/// covered by the pattern.
pub fn match_pattern(pattern: &PermissionPattern, inv: &ToolInvocation) -> bool {
    match pattern {
        PermissionPattern::BashPrefix { prefix } => {
            inv.tool == "Bash"
                && inv
                    .string_field("command")
                    .map(|c| c.starts_with(prefix.as_str()))
                    .unwrap_or(false)
        }
        PermissionPattern::WebFetchDomain { domain } => {
            if inv.tool != "WebFetch" {
                return false;
            }
            let Some(url_str) = inv.string_field("url") else {
                return false;
            };
            match Url::parse(url_str) {
                Ok(u) => {
                    let Some(host) = u.host_str() else {
                        return false;
                    };
                    host == domain || host.ends_with(&format!(".{domain}"))
                }
                Err(_) => false,
            }
        }
        PermissionPattern::EditGlob { glob } => {
            let Some(file) = inv.string_field("file_path") else {
                return false;
            };
            // Normalize: replace `\` with `/`, fold `..`/`.` so a pattern
            // like Edit(subdir/**) cannot match subdir/../../etc/passwd
            // by literal-prefix accident.
            let normalized = normalize_posix(file);
            match build_matcher(glob) {
                Ok(m) => m.is_match(&normalized),
                Err(_) => false,
            }
        }
        PermissionPattern::McpPrefix { prefix } => inv.tool.starts_with(prefix.as_str()),
    }
}

fn build_matcher(glob: &str) -> Result<GlobMatcher, globset::Error> {
    Glob::new(glob).map(|g| g.compile_matcher())
}

/// POSIX-style path normalization that mirrors `node:path/posix.normalize`
/// for the cases we care about (relative paths with `..` segments and
/// mixed slashes). We do NOT collapse leading `..` segments — they remain
/// so a `..` escape cannot accidentally land inside a permitted glob root.
fn normalize_posix(input: &str) -> String {
    let unified = input.replace('\\', "/");
    let pb = PathBuf::from(&unified);
    let mut out: Vec<String> = Vec::new();
    let mut leading_slash = unified.starts_with('/');
    for comp in pb.components() {
        match comp {
            Component::RootDir => {
                leading_slash = true;
            }
            Component::Normal(s) => {
                out.push(s.to_string_lossy().into_owned());
            }
            Component::ParentDir => {
                if let Some(last) = out.last() {
                    if last != ".." {
                        out.pop();
                        continue;
                    }
                }
                out.push("..".to_string());
            }
            Component::CurDir => {}
            Component::Prefix(_) => {} // Windows; ignore on POSIX folding.
        }
    }
    let joined = out.join("/");
    if leading_slash {
        if joined.is_empty() {
            "/".to_string()
        } else {
            format!("/{joined}")
        }
    } else if joined.is_empty() {
        ".".to_string()
    } else {
        joined
    }
}

/// Parse a serialized pattern string back into its typed form. Returns
/// `None` when the string does not match any known shape.
pub fn parse_pattern_string(s: &str) -> Option<PermissionPattern> {
    // Bash(<prefix>:*)
    if let Some(rest) = s.strip_prefix("Bash(") {
        if let Some(inside) = rest.strip_suffix(")") {
            if let Some(prefix) = inside.strip_suffix(":*") {
                return Some(PermissionPattern::BashPrefix {
                    prefix: prefix.to_string(),
                });
            }
        }
    }
    // WebFetch(domain:<X>)
    if let Some(rest) = s.strip_prefix("WebFetch(domain:") {
        if let Some(domain) = rest.strip_suffix(")") {
            return Some(PermissionPattern::WebFetchDomain {
                domain: domain.to_string(),
            });
        }
    }
    // Edit(<glob>)
    if let Some(rest) = s.strip_prefix("Edit(") {
        if let Some(glob) = rest.strip_suffix(")") {
            return Some(PermissionPattern::EditGlob {
                glob: glob.to_string(),
            });
        }
    }
    // mcp__server__*
    if s.starts_with("mcp__") && s.ends_with('*') {
        return Some(PermissionPattern::McpPrefix {
            prefix: s[..s.len() - 1].to_string(),
        });
    }
    None
}
