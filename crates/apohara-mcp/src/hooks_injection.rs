//! Per-provider agent-hooks config injection (Stage 2.6).
//!
//! Mirrors [`crate::injection`] (MCP injection) but writes the **hooks**
//! registration block into each CLI's real config so the wrapped agent fires
//! the `apohara-<provider>-hook` script on tool-use / stop / prompt events.
//! Those scripts POST to the loopback `apohara-hooks-server`.
//!
//! ## Config paths (load-bearing — verified against the spec `AGENT_CONFIG`)
//!
//! Unlike MCP injection, hook registration is **HOME-relative**, not
//! workspace-relative — the hook scripts live in `~/.<provider>/hooks/` and the
//! provider's user-global settings register them:
//!
//!   - claude-code-cli → `~/.claude/settings.json`   (JSON, `hooks` object —
//!     a command-style `{type:"command", command:"bash …"}` registration)
//!   - opencode-go     → REFUSED (see below)
//!   - codex-cli       → REFUSED (no stable upstream hooks contract)
//!
//! NOTE on opencode (past-incident + upstream verification): opencode has NO
//! JSON-config hooks mechanism comparable to Claude's. Its config lives at
//! `~/.config/opencode/opencode.json[c]` (or workspace-root `opencode.json[c]`)
//! and the old `~/.opencode/settings.json` path is read by NOTHING. More
//! importantly, opencode "hooks" are JavaScript/TypeScript *plugin modules*
//! (`.opencode/plugins/*.{js,ts}` exporting functions that return a hooks
//! object — events like `tool.execute.before`), not shell-command entries in a
//! settings file. A `bash apohara-opencode-hook.sh` command registration is
//! therefore untranslatable to opencode's model. We REFUSE opencode hooks
//! injection (same posture as codex) rather than write to a path/schema the
//! CLI ignores. Verified against opencode.ai/docs/config and /docs/plugins.
//!
//! ## Safety (§0.8 + backup + idempotent)
//!
//!   - Atomic write (tmp-in-same-dir + rename) so a crash never leaves a
//!     half-written settings file that breaks the provider's next startup.
//!   - `.bak` of any pre-existing config is taken BEFORE overwriting.
//!   - The merge is idempotent: re-running re-points the apohara hook to the
//!     current script path but never appends a duplicate entry (entries are
//!     keyed by a stable `command` marker).

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use crate::injection::ProviderId;

/// The five hook events Apohara cares about (spec §3.5). Registered under each
/// provider's matching settings key.
const HOOK_EVENTS: &[&str] = &[
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "UserPromptSubmit",
    "PermissionRequest",
];

/// Stable substring stamped into every command we write, so the idempotent
/// merge can recognize (and replace) an apohara-installed entry without
/// touching the user's own hooks.
const APOHARA_HOOK_MARKER: &str = "apohara-";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct HookInjectionResult {
    pub provider_id: ProviderId,
    pub config_path: PathBuf,
    /// Set when a pre-existing config was moved aside before overwriting.
    pub backup_path: Option<PathBuf>,
    pub bytes_written: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum HookInjectionError {
    #[error("codex hooks injection not supported (no upstream contract)")]
    CodexUnsupported,
    #[error(
        "opencode hooks injection not supported (opencode hooks are JS/TS \
         plugin modules, not a settings-file hooks block)"
    )]
    OpencodeUnsupported,
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialize: {0}")]
    Serialize(#[from] serde_json::Error),
    #[error("existing config at {path} is not a JSON object")]
    NotAnObject { path: PathBuf },
}

/// Single source of truth for a provider's hook wiring: the HOME-relative
/// config dir, settings file name, hook-script file name, and the script body
/// compiled into the binary (`scripts/hooks/*` is the on-repo source). Only
/// providers we actually support return `Some`; refused providers (codex,
/// opencode) return `None`, so this also gates which providers are wirable.
///
/// Centralizing dir + names + body here (instead of duplicating the
/// provider→script-name map across `resolve_paths`, the `include_str!` consts,
/// and the install-step match) means the registered command, the installed
/// file, and its bytes can never drift.
pub(crate) struct HookAssets {
    pub dir: &'static str,
    pub settings_file: &'static str,
    pub script_name: &'static str,
    pub script_body: &'static str,
}

pub(crate) fn hook_assets(provider_id: ProviderId) -> Option<HookAssets> {
    match provider_id {
        ProviderId::ClaudeCodeCli => Some(HookAssets {
            dir: ".claude",
            settings_file: "settings.json",
            script_name: "apohara-claude-hook.sh",
            script_body: include_str!("../../../scripts/hooks/apohara-claude-hook.sh"),
        }),
        // Refused — opencode hooks are JS/TS plugins, codex has no contract.
        ProviderId::OpencodeGo | ProviderId::CodexCli => None,
    }
}

/// Resolve the HOME-relative hooks config path + the on-disk hook-script path
/// for a supported provider, rooted at `config_home` (production: `$HOME`;
/// tests: a `TempDir`). Returns `(settings_path, script_path)`.
///
/// `script_path` is what we register in the settings file; the caller is
/// responsible for actually installing that script (via
/// `apohara_hooks::install_hook`). Returning it here keeps the path
/// resolution in one place so the registered command and the installed file
/// can never drift.
///
/// Callers MUST refuse unsupported providers (codex/opencode) before reaching
/// here — `inject_hooks_config` / `hooks_setup_for_provider_inner` already do.
pub fn resolve_paths(provider_id: ProviderId, config_home: &Path) -> (PathBuf, PathBuf) {
    let assets = hook_assets(provider_id)
        .expect("resolve_paths called for an unsupported provider — refuse it first");
    let base = config_home.join(assets.dir);
    (
        base.join(assets.settings_file),
        base.join("hooks").join(assets.script_name),
    )
}

/// Inject the apohara hooks block into the provider's settings, rooted at
/// `config_home`. Idempotent + atomic + backup-on-overwrite.
///
/// Only `claude-code-cli` is supported. `codex-cli` returns
/// [`HookInjectionError::CodexUnsupported`] (no stable upstream contract) and
/// `opencode-go` returns [`HookInjectionError::OpencodeUnsupported`] (opencode
/// hooks are JS/TS plugin modules, not a settings-file block). In both cases we
/// refuse rather than write a path/schema the CLI ignores.
pub async fn inject_hooks_config(
    provider_id: ProviderId,
    config_home: &Path,
) -> Result<HookInjectionResult, HookInjectionError> {
    match provider_id {
        ProviderId::CodexCli => return Err(HookInjectionError::CodexUnsupported),
        ProviderId::OpencodeGo => return Err(HookInjectionError::OpencodeUnsupported),
        ProviderId::ClaudeCodeCli => {}
    }
    let (settings_path, script_path) = resolve_paths(provider_id, config_home);
    let command = format!("bash {}", script_path.display());

    // Load existing settings (preserving the user's keys) or start fresh.
    let mut root = match tokio::fs::read(&settings_path).await {
        Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
            Ok(Value::Object(m)) => m,
            // A non-object or unparseable file: do NOT silently clobber the
            // user's content — back it up below and start fresh.
            Ok(_) | Err(_) => Map::new(),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Map::new(),
        Err(e) => return Err(HookInjectionError::Io(e)),
    };

    merge_hooks_block(&mut root, &command);

    let mut content = serde_json::to_string_pretty(&Value::Object(root))?;
    content.push('\n');

    // Back up any pre-existing file BEFORE overwriting it.
    let backup_path = backup_existing(&settings_path).await?;

    atomic_write(&settings_path, content.as_bytes()).await?;

    Ok(HookInjectionResult {
        provider_id,
        config_path: settings_path,
        backup_path,
        bytes_written: content.len(),
    })
}

/// Merge the apohara hook command into the `hooks` object idempotently.
///
/// For each event we ensure exactly one matcher group whose `hooks` array
/// contains our `command`. Re-running with a new script path REPLACES the
/// apohara entry (matched by the `apohara-` marker) instead of appending a
/// duplicate, and leaves any user-authored hooks untouched.
fn merge_hooks_block(root: &mut Map<String, Value>, command: &str) {
    let hooks = root
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()));
    let Value::Object(hooks) = hooks else {
        // `hooks` existed but wasn't an object — replace with a fresh one.
        *hooks = Value::Object(Map::new());
        return merge_hooks_block(root, command);
    };

    for event in HOOK_EVENTS {
        let groups = hooks
            .entry(*event)
            .or_insert_with(|| Value::Array(Vec::new()));
        let Value::Array(groups) = groups else {
            *groups = Value::Array(Vec::new());
            continue;
        };

        // Drop any prior apohara-installed group so we never duplicate, then
        // append the current one. User-authored groups are preserved.
        groups.retain(|g| !group_is_apohara(g));
        groups.push(json!({
            "matcher": "*",
            "hooks": [ { "type": "command", "command": command } ],
        }));
    }
}

/// True when a matcher group contains an apohara-installed command hook.
fn group_is_apohara(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .map(|hooks| {
            hooks.iter().any(|h| {
                h.get("command")
                    .and_then(Value::as_str)
                    .map(|c| c.contains(APOHARA_HOOK_MARKER))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

/// Copy an existing file to `<name>.bak` ONE-SHOT: the backup is created only
/// if it does not already exist, so an idempotent re-run never overwrites the
/// pristine original with the already-injected copy. Returns the backup path
/// when one was made (or already present). Mirrors the installer's discipline.
async fn backup_existing(path: &Path) -> Result<Option<PathBuf>, std::io::Error> {
    match tokio::fs::metadata(path).await {
        Ok(_) => {
            let backup = path.with_extension(format!(
                "{}.bak",
                path.extension().and_then(|e| e.to_str()).unwrap_or("")
            ));
            // ONE-SHOT: never clobber a pre-existing .bak — the first run
            // already captured the pristine original.
            match tokio::fs::metadata(&backup).await {
                Ok(_) => Ok(Some(backup)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    tokio::fs::copy(path, &backup).await?;
                    Ok(Some(backup))
                }
                Err(e) => Err(e),
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// §0.8 atomic write: tmp-in-same-dir + rename. Identical discipline to
/// `injection::atomic_write`.
async fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let tmp = tempfile::Builder::new()
        .prefix(".apohara-hooks-")
        .tempfile_in(parent)?;
    let tmp_path = tmp.path().to_path_buf();
    tokio::fs::write(&tmp_path, contents).await?;
    let (_keep, persisted) = tmp.keep().map_err(|e| e.error)?;
    tokio::fs::rename(&persisted, path).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // EVERY test points config_home at a TempDir — NEVER the real ~/.claude.

    #[tokio::test]
    async fn claude_injection_writes_hooks_object_at_home_relative_path() {
        let home = TempDir::new().unwrap();
        let res = inject_hooks_config(ProviderId::ClaudeCodeCli, home.path())
            .await
            .unwrap();
        assert_eq!(res.config_path, home.path().join(".claude/settings.json"));
        assert!(res.backup_path.is_none(), "fresh install — no backup");

        let raw = tokio::fs::read_to_string(&res.config_path).await.unwrap();
        let parsed: Value = serde_json::from_str(&raw).unwrap();
        let pre = &parsed["hooks"]["PreToolUse"][0];
        assert_eq!(pre["matcher"], "*");
        let cmd = pre["hooks"][0]["command"].as_str().unwrap();
        assert!(cmd.contains("apohara-claude-hook.sh"), "got: {cmd}");
        // All five events registered.
        for ev in HOOK_EVENTS {
            assert!(parsed["hooks"][ev].is_array(), "missing event {ev}");
        }
    }

    #[tokio::test]
    async fn opencode_is_refused_hooks_are_js_plugins_not_a_settings_block() {
        let home = TempDir::new().unwrap();
        let err = inject_hooks_config(ProviderId::OpencodeGo, home.path())
            .await
            .unwrap_err();
        // opencode has NO settings-file hooks block: its hooks are JS/TS plugin
        // modules. Refusing here also upholds the past-incident rule that the
        // old ~/.opencode/settings.json path is read by nothing. Nothing must
        // be written to disk.
        assert!(matches!(err, HookInjectionError::OpencodeUnsupported));
        assert!(!home.path().join(".opencode").exists());
    }

    #[tokio::test]
    async fn codex_is_refused_without_upstream_contract() {
        let home = TempDir::new().unwrap();
        let err = inject_hooks_config(ProviderId::CodexCli, home.path())
            .await
            .unwrap_err();
        assert!(matches!(err, HookInjectionError::CodexUnsupported));
    }

    #[tokio::test]
    async fn injection_is_idempotent_no_duplicate_entries() {
        let home = TempDir::new().unwrap();
        inject_hooks_config(ProviderId::ClaudeCodeCli, home.path())
            .await
            .unwrap();
        let res2 = inject_hooks_config(ProviderId::ClaudeCodeCli, home.path())
            .await
            .unwrap();
        // Second run found a file → made a backup.
        assert!(res2.backup_path.is_some());

        let raw = tokio::fs::read_to_string(&res2.config_path).await.unwrap();
        let parsed: Value = serde_json::from_str(&raw).unwrap();
        let groups = parsed["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(groups.len(), 1, "must not duplicate the apohara group");
    }

    #[tokio::test]
    async fn injection_preserves_user_hooks_and_other_keys() {
        let home = TempDir::new().unwrap();
        let path = home.path().join(".claude/settings.json");
        tokio::fs::create_dir_all(path.parent().unwrap())
            .await
            .unwrap();
        // A pre-existing settings file with a user key + a user hook.
        let existing = json!({
            "model": "claude-opus-4",
            "hooks": {
                "PreToolUse": [
                    { "matcher": "Write", "hooks": [ { "type": "command", "command": "bash my-own-hook.sh" } ] }
                ]
            }
        });
        tokio::fs::write(&path, serde_json::to_vec_pretty(&existing).unwrap())
            .await
            .unwrap();

        inject_hooks_config(ProviderId::ClaudeCodeCli, home.path())
            .await
            .unwrap();

        let raw = tokio::fs::read_to_string(&path).await.unwrap();
        let parsed: Value = serde_json::from_str(&raw).unwrap();
        // User's top-level key survives.
        assert_eq!(parsed["model"], "claude-opus-4");
        let groups = parsed["hooks"]["PreToolUse"].as_array().unwrap();
        // User's hook + apohara's hook coexist.
        assert_eq!(groups.len(), 2);
        let has_user = groups
            .iter()
            .any(|g| g["hooks"][0]["command"] == "bash my-own-hook.sh");
        let has_apohara = groups.iter().any(group_is_apohara);
        assert!(has_user, "user hook must be preserved");
        assert!(has_apohara, "apohara hook must be added");
    }

    #[tokio::test]
    async fn injection_backs_up_existing_config() {
        let home = TempDir::new().unwrap();
        let path = home.path().join(".claude/settings.json");
        tokio::fs::create_dir_all(path.parent().unwrap())
            .await
            .unwrap();
        tokio::fs::write(&path, b"{\"model\":\"x\"}\n").await.unwrap();

        let res = inject_hooks_config(ProviderId::ClaudeCodeCli, home.path())
            .await
            .unwrap();
        let backup = res.backup_path.expect("backup made");
        let backup_raw = tokio::fs::read_to_string(&backup).await.unwrap();
        assert!(backup_raw.contains("\"model\":\"x\""), "backup is the original");
    }

    #[tokio::test]
    async fn backup_is_one_shot_and_keeps_the_pristine_original() {
        let home = TempDir::new().unwrap();
        let path = home.path().join(".claude/settings.json");
        tokio::fs::create_dir_all(path.parent().unwrap())
            .await
            .unwrap();
        // Distinctive original content we must be able to recover later.
        tokio::fs::write(&path, b"{\"model\":\"pristine-original\"}\n")
            .await
            .unwrap();

        // First run backs up the original, then injects.
        let res1 = inject_hooks_config(ProviderId::ClaudeCodeCli, home.path())
            .await
            .unwrap();
        let backup = res1.backup_path.expect("first run makes a backup");

        // Second (idempotent) run must NOT clobber the .bak with the
        // already-injected file — the .bak must still be the pristine original.
        let res2 = inject_hooks_config(ProviderId::ClaudeCodeCli, home.path())
            .await
            .unwrap();
        assert_eq!(res2.backup_path.as_deref(), Some(backup.as_path()));

        let backup_raw = tokio::fs::read_to_string(&backup).await.unwrap();
        assert!(
            backup_raw.contains("pristine-original"),
            "backup must remain the pristine original, got: {backup_raw}"
        );
        assert!(
            !backup_raw.contains("apohara-"),
            "backup must NOT be the already-injected copy"
        );
    }

    #[test]
    fn resolve_paths_are_home_relative() {
        let home = Path::new("/home/u");
        let (settings, script) = resolve_paths(ProviderId::ClaudeCodeCli, home);
        assert_eq!(settings, Path::new("/home/u/.claude/settings.json"));
        assert_eq!(script, Path::new("/home/u/.claude/hooks/apohara-claude-hook.sh"));
    }
}
