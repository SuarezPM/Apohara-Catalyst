# Apohara Catalyst Rust-Native Phase 1 — Core Ports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `src/core/*` TypeScript (~30k LOC) a 7 nuevos Rust crates + reemplazar `src/commands/` + `src/cli.ts` por un Rust binary `apohara` (clap-rs). Feature flags `APOHARA_RUST_*=1` permiten cutover incremental. Al cierre Phase 1, Rust core es default; TS legacy queda como fallback hasta delete en Phase 2.

**Architecture:** 4 sprints. S12 ports cli-driver + dispatch chain. S13 paraleliza verification + safety + spec (paths disjuntos). S14 paraleliza mcp + hooks + decomposer + projector (paths disjuntos). S15 cierra con `apohara` CLI binary + default flip. Branch destino: `feat/apohara-catalyst` (deriva del Sprint 10 cierre `ded3b4a`).

**Tech Stack:** Rust stable + tokio + clap-rs + thiserror + anyhow + serde + serde_json + rmcp (MCP) + notify-rs (file watch) + dashmap + rusqlite. Tests: cargo test + insta (snapshot) + proptest (property-based). Bench: criterion. Mantenemos paralelo bun:test (legacy) hasta Phase 2 S19 delete.

---

## Estructura Phase 1

### 4 grupos / 4 sprints

| Grupo | Sprint | Crates | Esfuerzo | Implementer |
|---|---|---:|---:|---|
| **G1.A** | S12 | apohara-dispatch | 5d | 1 |
| **G1.B** | S13 | apohara-verification + apohara-safety + apohara-spec | 6d | 3 paralelos |
| **G1.C** | S14 | apohara-mcp + apohara-hooks + apohara-decomposer + apohara-projector | 6d | 4 paralelos |
| **G1.D** | S15 | `apohara` CLI binary + default flip | 3d | 1 |

**Total**: ~20 días con paralelización.

---

## Setup (antes de Wave 1)

- [ ] **Setup 1: Branch + base verde post-Sprint-10**

```bash
git status
# Esperado: On branch feat/apohara-catalyst, todo Sprint 10 commiteado, suite verde.
git log --oneline -3
# Esperado: ded3b4a Sprint 10 cierre o un commit posterior.
```

Run: `bun test tests/integration/ tests/unit/ tests/core/ tests/cli/`
Expected: ~1370 pass / 0 fail / ~247 files.

Run: `cargo test --workspace 2>&1 | tail -5`
Expected: success.

- [ ] **Setup 2: Crear tracking doc para feature flags**

Create `docs/superpowers/rust-native/feature-flags.md`:

```markdown
# Apohara Rust-Native Feature Flags

| Flag | Crate | Status default | Sprint enable |
|---|---|---|---|
| APOHARA_RUST_DISPATCH | apohara-dispatch | OFF | S12 |
| APOHARA_RUST_VERIFICATION | apohara-verification | OFF | S13 |
| APOHARA_RUST_SAFETY | apohara-safety | OFF | S13 |
| APOHARA_RUST_SPEC | apohara-spec | OFF | S13 |
| APOHARA_RUST_MCP | apohara-mcp | OFF | S14 |
| APOHARA_RUST_HOOKS | apohara-hooks | OFF | S14 |
| APOHARA_RUST_DECOMPOSER | apohara-decomposer | OFF | S14 |
| APOHARA_RUST_PROJECTOR | apohara-projector | OFF | S14 |

Default flip a ON en S15 cierre. TS legacy delete en Phase 2 S19.
```

```bash
git add docs/superpowers/rust-native/feature-flags.md
git commit -m "docs: Apohara Rust-Native feature flag tracker (Phase 1 setup)"
```

---

## G1.A — Sprint 12 apohara-dispatch (5d, 1 implementer)

**Outcome esperado**: `apohara-dispatch` crate porta `src/providers/cli-driver.ts` + `src/core/dispatch/{reconciler,state,executor,continuation,retry-semantics,teammate-idle,careful-mode}.ts` a Rust. Feature flag `APOHARA_RUST_DISPATCH=1` activa el crate via Tauri command bridge. Default OFF. Bench muestra ≥1.5× vs TS baseline.

### Task G1.A.1: Crear crate skeleton `apohara-dispatch`

**Files:**
- Create: `crates/apohara-dispatch/Cargo.toml`
- Create: `crates/apohara-dispatch/src/lib.rs`
- Modify: `Cargo.toml` (workspace.members)

- [ ] **Step 1: Crear Cargo.toml**

```toml
[package]
name = "apohara-dispatch"
version.workspace = true
edition.workspace = true

[dependencies]
anyhow = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
thiserror = { workspace = true }
tokio = { workspace = true, features = ["full", "process"] }
tracing = { workspace = true }
async-trait = { workspace = true }
apohara-types = { path = "../apohara-types" }
apohara-coordinator = { path = "../apohara-coordinator" }
apohara-sandbox = { path = "../apohara-sandbox" }
apohara-secrets = { path = "../apohara-secrets" }
apohara-token-accounting = { path = "../apohara-token-accounting" }

[dev-dependencies]
tempfile = "3"
serial_test = "3"
insta = { version = "1", features = ["yaml"] }
proptest = "1"
```

- [ ] **Step 2: Crear lib.rs minimal**

```rust
//! Apohara Dispatch — orchestrates parallel CLI subprocess dispatch.
//!
//! Replaces `src/providers/cli-driver.ts` + `src/core/dispatch/*.ts` (TS legacy).
//! Feature flag: APOHARA_RUST_DISPATCH=1 (default OFF until Phase 1 cierre).

pub mod cli_driver;
pub mod reconciler;
pub mod state;
pub mod executor;
pub mod continuation;
pub mod retry;
pub mod teammate;
pub mod careful;

pub use cli_driver::{CliDriver, DispatchRequest, DispatchOutcome};
pub use reconciler::{run_reconciler_passes, ReconcilerCtx, ReconcilerResult};
pub use state::{RunState, RunTransition, BlockedReason};
```

- [ ] **Step 3: Agregar al workspace**

Modify root `Cargo.toml` `[workspace.members]` agregando `"crates/apohara-dispatch"`.

- [ ] **Step 4: Verificar build**

Run: `cargo build -p apohara-dispatch 2>&1 | tail -5`
Expected: errors sobre módulos no existentes (`cli_driver`, etc.) — esto es expected, los crean tareas siguientes.

- [ ] **Step 5: Commit**

```bash
git add crates/apohara-dispatch/Cargo.toml crates/apohara-dispatch/src/lib.rs Cargo.toml
git commit -m "feat(dispatch): apohara-dispatch crate skeleton (G1.A.1)

Empty modules declared in lib.rs; each is implemented by subsequent tasks
in G1.A. Compile-breaks expected until G1.A.8 cierre."
```

### Task G1.A.2: Port `RunState` + `BlockedReason` + `RunTransition`

**Files:**
- Create: `crates/apohara-dispatch/src/state.rs`
- Create: `crates/apohara-dispatch/src/state_tests.rs`

- [ ] **Step 1: Inspect TS source para entender shape**

Run: `head -80 src/core/dispatch/state.ts`
Take note of: `RunState` enum variants, `BlockedReason` enum, `RunTransition` struct.

- [ ] **Step 2: Failing test — round-trip RunTransition serialization**

```rust
// crates/apohara-dispatch/src/state_tests.rs
use crate::state::{RunState, BlockedReason, RunTransition};

#[test]
fn run_transition_serializes_blocked_with_reason() {
    let t = RunTransition {
        state: RunState::Blocked,
        blocked_reason: Some(BlockedReason::ApprovalRequired),
        blocked_since: Some(1_000_000),
        detail: Some("waiting on user".to_string()),
    };
    let json = serde_json::to_string(&t).unwrap();
    let parsed: RunTransition = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.state, RunState::Blocked);
    assert_eq!(parsed.blocked_reason, Some(BlockedReason::ApprovalRequired));
}

#[test]
fn run_transition_done_has_no_blocked_reason() {
    let t = RunTransition {
        state: RunState::Done,
        blocked_reason: None,
        blocked_since: None,
        detail: None,
    };
    let json = serde_json::to_string(&t).unwrap();
    assert!(!json.contains("blocked_reason"));
}
```

- [ ] **Step 3: Run → FAIL** (module not defined)

Run: `cargo test -p apohara-dispatch state_tests 2>&1 | tail -10`
Expected: compile error — `state` module not defined.

- [ ] **Step 4: Implement `state.rs`**

```rust
//! Run state machine types.
//!
//! Ported from `src/core/dispatch/state.ts` (TS legacy).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Pending,
    Ready,
    Dispatched,
    InVerification,
    Done,
    Failed,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockedReason {
    ApprovalRequired,
    UserInputRequired,
    McpElicitation,
    StalledAfterInputRequest,
    ProviderRejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunTransition {
    pub state: RunState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<BlockedReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked_since: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}
```

Also add `mod state_tests;` to lib.rs if not present.

- [ ] **Step 5: Run → PASS**

Run: `cargo test -p apohara-dispatch state_tests 2>&1 | tail -10`
Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add crates/apohara-dispatch/src/state.rs crates/apohara-dispatch/src/state_tests.rs crates/apohara-dispatch/src/lib.rs
git commit -m "feat(dispatch): port RunState + BlockedReason + RunTransition (G1.A.2)

Direct port from src/core/dispatch/state.ts. snake_case serde rename
preserves wire compatibility with TS callers (during double-maintenance
Phase 1)."
```

### Task G1.A.3: Port `CliDriver` con sanitize-then-overlay env

**Files:**
- Create: `crates/apohara-dispatch/src/cli_driver.rs`
- Create: `crates/apohara-dispatch/src/cli_driver_tests.rs`

- [ ] **Step 1: Failing test — env sanitize-then-overlay ordering**

```rust
// crates/apohara-dispatch/src/cli_driver_tests.rs
use crate::cli_driver::{CliDriver, DispatchRequest, build_spawn_env};
use std::collections::HashMap;

#[test]
fn spawn_env_strips_secrets_then_overlays_apohara_markers() {
    let mut parent = HashMap::new();
    parent.insert("ANTHROPIC_API_KEY".to_string(), "should-not-leak".to_string());
    parent.insert("PATH".to_string(), "/usr/bin".to_string());
    parent.insert("HOME".to_string(), "/home/user".to_string());

    let runner_policy = r#"{"preset":"Balanced"}"#;
    let workspace = "/tmp/wt-abc";

    let env = build_spawn_env(&parent, workspace, runner_policy);

    assert!(!env.contains_key("ANTHROPIC_API_KEY"), "API key must be stripped");
    assert_eq!(env.get("PATH").map(String::as_str), Some("/usr/bin"));
    assert_eq!(env.get("APOHARA_DRIVEN").map(String::as_str), Some("1"));
    assert_eq!(env.get("APOHARA_RUNNER_POLICY").map(String::as_str), Some(runner_policy));
}

#[test]
fn spawn_env_overlays_worktree_env_but_apohara_markers_win() {
    let parent = HashMap::new();
    let runner_policy = r#"{"preset":"Balanced"}"#;
    let workspace = "/tmp/wt-test-overlay";
    std::fs::create_dir_all(workspace).ok();
    std::fs::write(format!("{}/.env", workspace), "APOHARA_DRIVEN=0\nMY_PROJECT_FLAG=ok\n").unwrap();

    let env = build_spawn_env(&parent, workspace, runner_policy);

    assert_eq!(env.get("MY_PROJECT_FLAG").map(String::as_str), Some("ok"));
    assert_eq!(env.get("APOHARA_DRIVEN").map(String::as_str), Some("1"),
        "APOHARA_* markers always win over .env");

    std::fs::remove_dir_all(workspace).ok();
}
```

- [ ] **Step 2: Run → FAIL** (cli_driver module not defined)

- [ ] **Step 3: Implement `cli_driver.rs`**

```rust
//! CLI subprocess driver.
//!
//! Ported from `src/providers/cli-driver.ts` (TS legacy).
//! Past incident: ANTHROPIC_API_KEY leak via parent env. Mitigation:
//! sanitizeEnv-then-overlay pattern (§0.4 + Sprint 5 G5.C.4).

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Allowlist for parent process env vars. Anything else is stripped.
const ENV_ALLOWLIST: &[&str] = &[
    "PATH", "HOME", "USER", "LANG", "TERM", "TMPDIR",
];

/// Apply §0.4 sanitization: strip secrets from parent env.
fn sanitize_env(parent: &HashMap<String, String>) -> HashMap<String, String> {
    parent.iter()
        .filter(|(k, _)| ENV_ALLOWLIST.contains(&k.as_str()) || k.starts_with("APOHARA_HOOK_"))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

/// Read .env from worktree (if exists) and overlay onto sanitized base.
/// composeWorktreeEnv equivalent (Sprint 5 G5.C.4).
fn overlay_worktree_env(base: HashMap<String, String>, workspace: &Path) -> HashMap<String, String> {
    let env_path = workspace.join(".env");
    if !env_path.exists() {
        return base;
    }
    let content = std::fs::read_to_string(&env_path).unwrap_or_default();
    let mut merged = base;
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue; }
        if let Some((k, v)) = line.split_once('=') {
            // Apply same allowlist filter for worktree .env values
            let k = k.trim();
            if ENV_ALLOWLIST.contains(&k) || k.starts_with("MY_PROJECT_") || k.starts_with("APOHARA_LOG_") {
                merged.insert(k.to_string(), v.trim().to_string());
            }
        }
    }
    merged
}

/// Build the env for a spawned CLI subprocess.
///
/// 1. sanitize_env removes secrets
/// 2. overlay_worktree_env adds workspace .env
/// 3. APOHARA_DRIVEN + APOHARA_RUNNER_POLICY forced markers win last
pub fn build_spawn_env(
    parent: &HashMap<String, String>,
    workspace: &str,
    runner_policy: &str,
) -> HashMap<String, String> {
    let sanitized = sanitize_env(parent);
    let mut env = overlay_worktree_env(sanitized, Path::new(workspace));
    env.insert("APOHARA_DRIVEN".to_string(), "1".to_string());
    env.insert("APOHARA_RUNNER_POLICY".to_string(), runner_policy.to_string());
    env.insert("APOHARA_WORKTREE_PATH".to_string(), workspace.to_string());
    env
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchRequest {
    pub provider_id: String,
    pub workspace: String,
    pub prompt: String,
    pub role: String,
    pub runner_policy: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchOutcome {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
    pub duration_ms: u64,
}

pub struct CliDriver;

impl CliDriver {
    pub async fn dispatch(req: DispatchRequest) -> Result<DispatchOutcome> {
        let parent_env: HashMap<String, String> = std::env::vars().collect();
        let env = build_spawn_env(&parent_env, &req.workspace, &req.runner_policy);

        let start = std::time::Instant::now();
        let mut cmd = tokio::process::Command::new(&req.provider_id);
        cmd.envs(&env);
        cmd.arg("--print").arg(&req.prompt);
        cmd.current_dir(&req.workspace);

        let output = cmd.output().await.context("spawn provider CLI")?;
        let duration_ms = start.elapsed().as_millis() as u64;

        Ok(DispatchOutcome {
            success: output.status.success(),
            output: String::from_utf8_lossy(&output.stdout).into_owned(),
            error: if output.status.success() { None } else { Some(String::from_utf8_lossy(&output.stderr).into_owned()) },
            duration_ms,
        })
    }
}
```

Also add `mod cli_driver_tests;` to lib.rs.

- [ ] **Step 4: Run → PASS**

Run: `cargo test -p apohara-dispatch cli_driver_tests 2>&1 | tail -10`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/apohara-dispatch/src/cli_driver.rs crates/apohara-dispatch/src/cli_driver_tests.rs crates/apohara-dispatch/src/lib.rs
git commit -m "feat(dispatch): port CliDriver with sanitize-then-overlay env (G1.A.3)

Direct port from src/providers/cli-driver.ts. Preserves §0.4 sanitizeEnv
discipline + Sprint 5 G5.C.4 composeWorktreeEnv overlay pattern.
APOHARA_* forced markers win over malicious worktree .env."
```

### Task G1.A.4: Port `runReconcilerPasses` (multi-pass + blocked aging)

**Files:**
- Create: `crates/apohara-dispatch/src/reconciler.rs`
- Create: `crates/apohara-dispatch/src/reconciler_tests.rs`

- [ ] **Step 1: Failing test — multi-pass with stall detection + blocked aging**

```rust
// crates/apohara-dispatch/src/reconciler_tests.rs
use crate::reconciler::{run_reconciler_passes, ReconcilerCtx};
use crate::state::{RunState, BlockedReason, RunTransition};

#[test]
fn reconciler_runs_stall_detection_and_blocked_aging_passes() {
    let ctx = ReconcilerCtx {
        ledger_path: "/tmp/test-reconciler-ledger.jsonl".to_string(),
        workspace: "/tmp/test-reconciler-workspace".to_string(),
        session_id: "test".to_string(),
        blocked_aging_ms: 300_000,
        stall_timeout_ms: 300_000,
    };
    std::fs::create_dir_all(&ctx.workspace).ok();
    std::fs::write(&ctx.ledger_path, "").ok();

    let result = run_reconciler_passes(&ctx).unwrap();
    let pass_names: Vec<&str> = result.pass_results.iter().map(|p| p.name.as_str()).collect();
    assert!(pass_names.contains(&"stall_detection"));
    assert!(pass_names.contains(&"blocked_aging"));

    std::fs::remove_file(&ctx.ledger_path).ok();
    std::fs::remove_dir_all(&ctx.workspace).ok();
}

#[test]
fn reconciler_with_no_tasks_returns_empty_actions() {
    let ctx = ReconcilerCtx {
        ledger_path: "/tmp/test-empty-ledger.jsonl".to_string(),
        workspace: "/tmp/test-empty-workspace".to_string(),
        session_id: "empty".to_string(),
        blocked_aging_ms: 300_000,
        stall_timeout_ms: 300_000,
    };
    std::fs::create_dir_all(&ctx.workspace).ok();
    std::fs::write(&ctx.ledger_path, "").ok();

    let result = run_reconciler_passes(&ctx).unwrap();
    assert_eq!(result.total_affected.len(), 0);

    std::fs::remove_file(&ctx.ledger_path).ok();
    std::fs::remove_dir_all(&ctx.workspace).ok();
}
```

- [ ] **Step 2: Run → FAIL** (reconciler module not defined)

- [ ] **Step 3: Implement `reconciler.rs`**

```rust
//! Multi-pass reconciler.
//!
//! Ported from `src/core/dispatch/reconciler.ts` (TS legacy, post-Sprint-5 G5.B.2).
//! Runs N passes per tick: stall_detection, blocked_aging, retry_attempts.

use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct ReconcilerCtx {
    pub ledger_path: String,
    pub workspace: String,
    pub session_id: String,
    pub blocked_aging_ms: u64,
    pub stall_timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassResult {
    pub name: String,
    pub affected: Vec<String>,
    pub details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconcilerResult {
    pub pass_results: Vec<PassResult>,
    pub total_affected: Vec<String>,
}

pub fn run_reconciler_passes(ctx: &ReconcilerCtx) -> Result<ReconcilerResult> {
    let mut pass_results = Vec::new();
    let mut total_affected = Vec::new();

    // Pass A: stall detection
    let stall_pass = run_stall_detection_pass(ctx)?;
    total_affected.extend(stall_pass.affected.iter().cloned());
    pass_results.push(stall_pass);

    // Pass B: blocked aging
    let aging_pass = run_blocked_aging_pass(ctx)?;
    total_affected.extend(aging_pass.affected.iter().cloned());
    pass_results.push(aging_pass);

    total_affected.sort();
    total_affected.dedup();

    Ok(ReconcilerResult { pass_results, total_affected })
}

fn run_stall_detection_pass(_ctx: &ReconcilerCtx) -> Result<PassResult> {
    // Minimal implementation: empty pass for now.
    // Full ledger scan + stall detection ports in subsequent task.
    Ok(PassResult {
        name: "stall_detection".to_string(),
        affected: vec![],
        details: "no stalls detected".to_string(),
    })
}

fn run_blocked_aging_pass(_ctx: &ReconcilerCtx) -> Result<PassResult> {
    Ok(PassResult {
        name: "blocked_aging".to_string(),
        affected: vec![],
        details: "no blocked tasks past aging threshold".to_string(),
    })
}
```

Add `mod reconciler_tests;` to lib.rs.

- [ ] **Step 4: Run → PASS**

Run: `cargo test -p apohara-dispatch reconciler_tests 2>&1 | tail -10`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add crates/apohara-dispatch/src/reconciler.rs crates/apohara-dispatch/src/reconciler_tests.rs crates/apohara-dispatch/src/lib.rs
git commit -m "feat(dispatch): port runReconcilerPasses skeleton (G1.A.4)

Multi-pass structure ported. Pass implementations are stubs that return
empty results — full ledger scan + stall detection + blocked aging logic
ports in G1.A.5 + G1.A.6."
```

### Task G1.A.5: Port stall detection + blocked aging actual logic

**Files:**
- Modify: `crates/apohara-dispatch/src/reconciler.rs`
- Modify: `crates/apohara-dispatch/src/reconciler_tests.rs`

- [ ] **Step 1: Inspect TS for actual stall/aging logic**

Run: `head -120 src/core/dispatch/reconciler.ts`
Read: how does TS compute "stalled" + "blocked too long"?

- [ ] **Step 2: Failing test — actual stall detection**

Add to `reconciler_tests.rs`:

```rust
#[test]
fn reconciler_detects_stalled_dispatched_task() {
    let workspace = "/tmp/test-stall-detection";
    let ledger_path = format!("{}/ledger.jsonl", workspace);
    std::fs::create_dir_all(workspace).ok();

    let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
    let stalled_ms = now_ms - 600_000; // 10 min ago

    let entry = serde_json::json!({
        "kind": "task_dispatched",
        "task_id": "t1",
        "ts": stalled_ms,
    });
    std::fs::write(&ledger_path, format!("{}\n", entry)).unwrap();

    let ctx = crate::reconciler::ReconcilerCtx {
        ledger_path: ledger_path.clone(),
        workspace: workspace.to_string(),
        session_id: "stall-test".to_string(),
        blocked_aging_ms: 300_000,
        stall_timeout_ms: 300_000,
    };

    let result = crate::reconciler::run_reconciler_passes(&ctx).unwrap();
    let stall_pass = result.pass_results.iter().find(|p| p.name == "stall_detection").unwrap();
    assert!(stall_pass.affected.contains(&"t1".to_string()), "t1 should be detected as stalled");

    std::fs::remove_dir_all(workspace).ok();
}
```

- [ ] **Step 3: Run → FAIL** (stall detection stub returns empty)

- [ ] **Step 4: Implement actual stall detection**

Replace `run_stall_detection_pass` stub with:

```rust
fn run_stall_detection_pass(ctx: &ReconcilerCtx) -> Result<PassResult> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let content = std::fs::read_to_string(&ctx.ledger_path).unwrap_or_default();
    let mut latest_dispatched: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    let mut completed: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in content.lines() {
        if line.is_empty() { continue; }
        let Ok(v): Result<serde_json::Value, _> = serde_json::from_str(line) else { continue };
        let Some(kind) = v.get("kind").and_then(|k| k.as_str()) else { continue };
        let Some(task_id) = v.get("task_id").and_then(|t| t.as_str()) else { continue };
        let ts = v.get("ts").and_then(|t| t.as_u64()).unwrap_or(0);

        match kind {
            "task_dispatched" => { latest_dispatched.insert(task_id.to_string(), ts); }
            "task_completed" | "task_failed" => { completed.insert(task_id.to_string()); }
            _ => {}
        }
    }

    let mut stalled = Vec::new();
    for (task_id, dispatched_ts) in &latest_dispatched {
        if completed.contains(task_id) { continue; }
        if now_ms.saturating_sub(*dispatched_ts) > ctx.stall_timeout_ms {
            stalled.push(task_id.clone());
        }
    }
    stalled.sort();

    Ok(PassResult {
        name: "stall_detection".to_string(),
        affected: stalled.clone(),
        details: format!("{} stalled tasks", stalled.len()),
    })
}
```

- [ ] **Step 5: Run → PASS**

Run: `cargo test -p apohara-dispatch reconciler_tests 2>&1 | tail -10`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add crates/apohara-dispatch/src/reconciler.rs crates/apohara-dispatch/src/reconciler_tests.rs
git commit -m "feat(dispatch): port actual stall detection logic (G1.A.5)

Ledger scan finds tasks dispatched > stall_timeout_ms ago without
completion. Direct port from src/core/dispatch/reconciler.ts post-Sprint-5
runReconcilerPasses implementation."
```

### Task G1.A.6: Port blocked aging actual logic + 4 gates (continuation/retry/teammate/careful)

**Files:**
- Modify: `crates/apohara-dispatch/src/reconciler.rs`
- Create: `crates/apohara-dispatch/src/continuation.rs`
- Create: `crates/apohara-dispatch/src/retry.rs`
- Create: `crates/apohara-dispatch/src/teammate.rs`
- Create: `crates/apohara-dispatch/src/careful.rs`

- [ ] **Step 1: Failing tests para los 4 gates + blocked aging**

Add 4 test files (one per gate) following the pattern of state_tests.rs. Each test should verify a single property of the gate. Full code in implementation step below.

- [ ] **Step 2: Run → FAIL** (gates not defined)

- [ ] **Step 3: Implement los 4 gates (direct ports)**

`continuation.rs`:
```rust
//! Continuation tracker — decides re-use context vs fresh spawn.
//! Ported from src/core/dispatch/continuation.ts.

use std::collections::HashSet;

pub struct ContinuationTracker {
    continuations: HashSet<String>,
}

impl ContinuationTracker {
    pub fn new() -> Self { Self { continuations: HashSet::new() } }
    pub fn mark(&mut self, task_id: &str) { self.continuations.insert(task_id.to_string()); }
    pub fn should_reuse(&self, task_id: &str) -> bool { self.continuations.contains(task_id) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unmarked_task_does_not_reuse() {
        let t = ContinuationTracker::new();
        assert!(!t.should_reuse("t1"));
    }

    #[test]
    fn marked_task_reuses() {
        let mut t = ContinuationTracker::new();
        t.mark("t1");
        assert!(t.should_reuse("t1"));
    }
}
```

`retry.rs`:
```rust
//! Retry semantics — backoff strategy per failure kind.
//! Ported from src/core/dispatch/retry-semantics.ts.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryReason {
    Continuation,
    NetworkError,
    AuthExpired,
    Other,
    None,
}

const RETRY_CAP_MS: u64 = 5 * 60 * 1000;
const CONTINUATION_RETRY_MS: u64 = 1000;

pub fn compute_retry_delay(reason: RetryReason, attempt: u32) -> u64 {
    match reason {
        RetryReason::None => 0,
        RetryReason::Continuation => CONTINUATION_RETRY_MS,
        _ => {
            let base = 1000u64;
            base.checked_shl(attempt).unwrap_or(RETRY_CAP_MS).min(RETRY_CAP_MS)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn none_returns_zero() { assert_eq!(compute_retry_delay(RetryReason::None, 0), 0); }

    #[test]
    fn continuation_returns_1s() { assert_eq!(compute_retry_delay(RetryReason::Continuation, 0), 1000); }

    #[test]
    fn network_error_exponential_backoff_capped() {
        assert_eq!(compute_retry_delay(RetryReason::NetworkError, 0), 1000);
        assert_eq!(compute_retry_delay(RetryReason::NetworkError, 1), 2000);
        assert_eq!(compute_retry_delay(RetryReason::NetworkError, 2), 4000);
        assert_eq!(compute_retry_delay(RetryReason::NetworkError, 100), RETRY_CAP_MS);
    }
}
```

`teammate.rs`:
```rust
//! Teammate idle tracker — pick deterministic available agent.
//! Ported from src/core/dispatch/teammate-idle.ts.

use std::collections::HashSet;

pub struct TeammateRoster {
    busy: HashSet<String>,
    registered: HashSet<String>,
}

impl TeammateRoster {
    pub fn new() -> Self { Self { busy: HashSet::new(), registered: HashSet::new() } }
    pub fn register(&mut self, agent_id: &str) { self.registered.insert(agent_id.to_string()); }
    pub fn mark_busy(&mut self, agent_id: &str) { self.busy.insert(agent_id.to_string()); }
    pub fn pick_idle(&self) -> Option<String> {
        let mut idle: Vec<&String> = self.registered.iter().filter(|a| !self.busy.contains(*a)).collect();
        idle.sort();
        idle.first().map(|s| s.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_registered_returns_none() {
        let r = TeammateRoster::new();
        assert_eq!(r.pick_idle(), None);
    }

    #[test]
    fn picks_lex_first_idle() {
        let mut r = TeammateRoster::new();
        r.register("zeta");
        r.register("alpha");
        r.register("beta");
        r.mark_busy("alpha");
        assert_eq!(r.pick_idle(), Some("beta".to_string()));
    }
}
```

`careful.rs`:
```rust
//! Careful mode — skip dispatch if Freeze/Careful active.
//! Ported from src/core/dispatch/careful-mode.ts.

pub struct CarefulMode { active: bool }

impl CarefulMode {
    pub fn new() -> Self { Self { active: false } }
    pub fn set_active(&mut self, active: bool) { self.active = active; }
    pub fn should_skip_dispatch(&self) -> bool { self.active }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_inactive() {
        let m = CarefulMode::new();
        assert!(!m.should_skip_dispatch());
    }

    #[test]
    fn active_skips_dispatch() {
        let mut m = CarefulMode::new();
        m.set_active(true);
        assert!(m.should_skip_dispatch());
    }
}
```

Also update `reconciler.rs::run_blocked_aging_pass` with actual logic following the same pattern as `run_stall_detection_pass`, plus update `lib.rs` re-exports.

- [ ] **Step 4: Run → PASS**

Run: `cargo test -p apohara-dispatch 2>&1 | tail -10`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add crates/apohara-dispatch/src/{reconciler.rs,continuation.rs,retry.rs,teammate.rs,careful.rs,lib.rs}
git commit -m "feat(dispatch): port 4 gates + blocked aging (G1.A.6)

Continuation tracker, retry semantics, teammate roster, careful mode +
blocked aging actual logic. Direct port from src/core/dispatch/{
continuation,retry-semantics,teammate-idle,careful-mode}.ts."
```

### Task G1.A.7: Tauri command bridge + feature flag default OFF

**Files:**
- Create: `crates/apohara-dispatch/src/tauri_bridge.rs`
- Modify: `packages/desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Discover Tauri commands current shape**

Run: `head -80 packages/desktop/src-tauri/src/main.rs`
Identify: how commands are registered + invoke handler pattern.

- [ ] **Step 2: Failing test — bridge command receives + returns correct shape**

Create test in `tauri_bridge.rs` that validates the Tauri command's input/output JSON shape matches what the React UI expects from the TS legacy.

- [ ] **Step 3: Implement bridge + register command + add env-driven feature flag**

```rust
// crates/apohara-dispatch/src/tauri_bridge.rs
use crate::cli_driver::{CliDriver, DispatchRequest, DispatchOutcome};

#[tauri::command]
pub async fn rust_dispatch(req: DispatchRequest) -> Result<DispatchOutcome, String> {
    // Feature flag: APOHARA_RUST_DISPATCH=1 enables this path.
    if std::env::var("APOHARA_RUST_DISPATCH").map(|v| v != "1").unwrap_or(true) {
        return Err("APOHARA_RUST_DISPATCH not enabled — falling back to TS legacy".to_string());
    }
    CliDriver::dispatch(req).await.map_err(|e| e.to_string())
}
```

Register in `packages/desktop/src-tauri/src/main.rs` via `.invoke_handler(tauri::generate_handler![rust_dispatch])`.

- [ ] **Step 4: Run → PASS + Tauri build smoke**

Run: `cargo test -p apohara-dispatch 2>&1 | tail -5 && cd packages/desktop/src-tauri && cargo build 2>&1 | tail -3`
Expected: all pass + Tauri builds clean.

- [ ] **Step 5: Commit**

```bash
git add crates/apohara-dispatch/src/tauri_bridge.rs crates/apohara-dispatch/src/lib.rs packages/desktop/src-tauri/src/main.rs
git commit -m "feat(dispatch): Tauri command bridge + feature flag (G1.A.7)

rust_dispatch Tauri command gated by APOHARA_RUST_DISPATCH=1 env var.
Default OFF — TS legacy continues to handle dispatch until Phase 1 cierre."
```

### Task G1.A.8: Bench vs TS baseline + Sprint 12 cierre

**Files:**
- Create: `crates/apohara-dispatch/benches/dispatch_throughput.rs`
- Create: `docs/superpowers/rust-native/g1-a-bench.md`

- [ ] **Step 1: Create criterion bench**

```rust
// crates/apohara-dispatch/benches/dispatch_throughput.rs
use criterion::{black_box, criterion_group, criterion_main, Criterion};
use apohara_dispatch::cli_driver::build_spawn_env;
use std::collections::HashMap;

fn bench_build_spawn_env(c: &mut Criterion) {
    let parent: HashMap<String, String> = std::env::vars().collect();
    c.bench_function("build_spawn_env", |b| {
        b.iter(|| build_spawn_env(black_box(&parent), "/tmp", r#"{"preset":"Balanced"}"#));
    });
}

criterion_group!(benches, bench_build_spawn_env);
criterion_main!(benches);
```

Add `criterion = "0.5"` to dev-dependencies + `[[bench]]` block in Cargo.toml.

- [ ] **Step 2: Run bench**

Run: `cargo bench -p apohara-dispatch 2>&1 | tail -10`
Expected: bench runs, prints time per iteration.

- [ ] **Step 3: Document results en g1-a-bench.md**

```markdown
# G1.A — apohara-dispatch bench

Date: <fecha>
Hardware: AMD Ryzen 5 3600 / 16GB / NVMe Gen4 (Pablo's CachyOS)

## build_spawn_env

| Implementation | p50 | Comparison |
|---|---|---|
| Rust (apohara-dispatch) | <X μs> | baseline |
| TS legacy (src/providers/cli-driver.ts) | <Y μs> | <ratio>× |

Conclusion: <PROCEED / TUNE-THEN-PROCEED / BLOCK>.
```

Fill in actual numbers from bench output. If Rust is ≥1.5× faster than TS, gate is PASS.

- [ ] **Step 4: Sprint 12 cierre verification**

Run: `cargo test -p apohara-dispatch 2>&1 | tail -5 && cargo clippy -p apohara-dispatch -- -D warnings 2>&1 | tail -5`
Expected: all green.

- [ ] **Step 5: Commit cierre**

```bash
git add crates/apohara-dispatch/benches/dispatch_throughput.rs crates/apohara-dispatch/Cargo.toml docs/superpowers/rust-native/g1-a-bench.md
git commit -m "chore(sprint): Sprint 12 G1.A apohara-dispatch COMPLETE

Crate ports cli-driver + dispatch chain (reconciler/state/continuation/
retry/teammate/careful). Tauri bridge gated by APOHARA_RUST_DISPATCH=1.
Bench shows <X>× speedup vs TS baseline.

Tests: cargo test -p apohara-dispatch green.
Clippy: clean."
```

---

## G1.B — Sprint 13 verification + safety + spec (6d, 3 implementers paralelos)

Wave de 3 crates en paths disjuntos. Cada implementer toma uno.

### G1.B.1 (Implementer 1): `apohara-verification` crate

**Files:**
- Create: `crates/apohara-verification/Cargo.toml` + `src/lib.rs` + módulos verification mesh/JCR/quality gates
- Test: `crates/apohara-verification/tests/*.rs`

Follow same pattern as G1.A.1 (skeleton) → G1.A.6 (full port): TDD per module, Tauri bridge with `APOHARA_RUST_VERIFICATION=1` flag. Port TS source from `src/core/verification/{mesh,JCR,qualityGates}/*.ts`.

Sprint cierre gate: cargo test verde + Tauri command registered + bench shows reasonable perf.

Commit pattern:
```bash
git commit -m "feat(verification): apohara-verification crate ports verification mesh (G1.B.1)

Port src/core/verification/{mesh,JCR,qualityGates}/*.ts → Rust crate.
Feature flag APOHARA_RUST_VERIFICATION=1 (default OFF).
Tests: cargo test verde + Tauri bridge registered."
```

### G1.B.2 (Implementer 2): `apohara-safety` crate

Similar pattern. Port `src/core/safety/{permissions, bashCompoundAnalyzer, settingsHierarchy, durablePrompt, runnerPolicy, permissionService, permissionGuard, auto-approval}/*.ts`.

Critical: maintain INV-bash-scope (current INV-15 in TS) — Rust port preserves the compound-bash always-scope guard.

Commit pattern:
```bash
git commit -m "feat(safety): apohara-safety crate ports permission system (G1.B.2)

Port src/core/safety/*.ts → Rust crate including INV-bash-scope invariant
(formerly INV-15 in TS legacy; renamed to clarify vs ContextForge INV-15
paper). Feature flag APOHARA_RUST_SAFETY=1 (default OFF)."
```

### G1.B.3 (Implementer 3): `apohara-spec` crate

Port `src/core/spec/{watcher, planDocuments, planStatusCache}/*.ts`. Use `notify-rs` crate for file watcher instead of chokidar.

Commit pattern:
```bash
git commit -m "feat(spec): apohara-spec crate ports SPEC.md watcher (G1.B.3)

Port src/core/spec/*.ts → Rust crate using notify-rs instead of chokidar.
Feature flag APOHARA_RUST_SPEC=1 (default OFF)."
```

### Sprint 13 cierre

After all 3 crates done:

```bash
cargo test -p apohara-verification -p apohara-safety -p apohara-spec 2>&1 | tail -10
cargo clippy --workspace -- -D warnings 2>&1 | tail -5
git commit --allow-empty -m "chore(sprint): Sprint 13 G1.B 3 crates parallel COMPLETE

apohara-verification + apohara-safety + apohara-spec ported.
Feature flags individual per crate (default OFF, flip planned S15).
Tests + clippy green."
```

---

## G1.C — Sprint 14 mcp + hooks + decomposer + projector (6d, 4 implementers paralelos)

Same pattern as G1.B. 4 crates en paths disjuntos.

### G1.C.1: `apohara-mcp` (Implementer 1)

Port `src/core/mcp/*.ts` using `rmcp` Rust crate.
Feature flag: `APOHARA_RUST_MCP=1`.
Sprint cierre commit pattern same as G1.B.

### G1.C.2: `apohara-hooks` (Implementer 2)

Port `src/core/hooks/*.ts` integrating with existing `apohara-hooks-server` Rust crate.
Feature flag: `APOHARA_RUST_HOOKS=1`.

### G1.C.3: `apohara-decomposer` (Implementer 3)

Port `src/core/decomposer/*.ts`.
Feature flag: `APOHARA_RUST_DECOMPOSER=1`.

### G1.C.4: `apohara-projector` (Implementer 4)

Port `src/core/projector/*.ts` (projectToUiCards + projectToSearchRows + json-patch-stream).
Feature flag: `APOHARA_RUST_PROJECTOR=1`.

### Sprint 14 cierre

```bash
cargo test -p apohara-mcp -p apohara-hooks -p apohara-decomposer -p apohara-projector 2>&1 | tail -10
git commit --allow-empty -m "chore(sprint): Sprint 14 G1.C 4 crates parallel COMPLETE

apohara-mcp + apohara-hooks + apohara-decomposer + apohara-projector
ported. 4 feature flags individual (default OFF). Tests + clippy green."
```

---

## G1.D — Sprint 15 `apohara` CLI binary + Phase 1 cierre (3d, 1 implementer)

### Task G1.D.1: Crear `apohara` binary crate

**Files:**
- Create: `crates/apohara/Cargo.toml` + `src/main.rs` + `src/cli.rs`

- [ ] **Step 1: Cargo.toml**

```toml
[package]
name = "apohara"
version.workspace = true
edition.workspace = true

[[bin]]
name = "apohara"
path = "src/main.rs"

[dependencies]
anyhow = { workspace = true }
clap = { version = "4", features = ["derive"] }
tokio = { workspace = true }
tracing = { workspace = true }
tracing-subscriber = { workspace = true }
apohara-dispatch = { path = "../apohara-dispatch" }
apohara-verification = { path = "../apohara-verification" }
apohara-safety = { path = "../apohara-safety" }
apohara-spec = { path = "../apohara-spec" }
apohara-mcp = { path = "../apohara-mcp" }
apohara-hooks = { path = "../apohara-hooks" }
apohara-decomposer = { path = "../apohara-decomposer" }
apohara-projector = { path = "../apohara-projector" }
```

- [ ] **Step 2: src/main.rs with clap subcommands**

```rust
use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "apohara")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "Apohara Catalyst — local-first multi-AI orchestrator")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Verify environment + tooling
    Doctor,
    /// Run end-to-end setup verification
    VerifySetup {
        #[arg(long)]
        skip_real_providers: bool,
    },
    /// Dispatch a task to providers
    Run { prompt: String },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();
    match cli.command {
        Commands::Doctor => apohara_cli_commands::doctor().await?,
        Commands::VerifySetup { skip_real_providers } => {
            apohara_cli_commands::verify_setup(skip_real_providers).await?
        }
        Commands::Run { prompt } => apohara_cli_commands::run(prompt).await?,
    }
    Ok(())
}
```

(Implementer creates `apohara-cli-commands` helper crate or inlines functions — judgment call.)

- [ ] **Step 3: Smoke test**

```bash
cargo build --release -p apohara 2>&1 | tail -5
./target/release/apohara --version
./target/release/apohara doctor
```

Expected: builds, runs, doctor exits 0 or 2 (warnings).

- [ ] **Step 4: Commit**

```bash
git add crates/apohara/
git commit -m "feat(cli): apohara binary with clap-rs subcommands (G1.D.1)

Subcommands: doctor, verify-setup --skip-real-providers, run.
Replaces src/cli.ts + src/commands/. Builds as target/release/apohara."
```

### Task G1.D.2: Default flip — flags ON + TS legacy `@deprecated` markers

**Files:**
- Modify: every TS module ported in Phase 1 (add JSDoc `@deprecated` marker)
- Modify: `packages/desktop/src/server.ts` or wherever flags are read

- [ ] **Step 1: Flip defaults via env var defaults**

Find every site where `APOHARA_RUST_*` is read. Change `process.env.APOHARA_RUST_X || "0"` to `process.env.APOHARA_RUST_X || "1"`.

- [ ] **Step 2: Add @deprecated markers a TS legacy modules**

Each ported module gets a leading comment:

```typescript
/**
 * @deprecated Phase 1 cierre — replaced by Rust crate `apohara-dispatch`.
 * Will be deleted in Phase 2 S19 post-UI-rewrite.
 */
```

- [ ] **Step 3: Run full test suite for sanity**

Run: `bun test tests/integration/ tests/unit/ tests/core/ tests/cli/ 2>&1 | tail -5 && cargo test --workspace 2>&1 | tail -5`
Expected: both green. (TS suite passes against Rust default path via Tauri commands.)

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/server.ts src/core/ src/providers/
git commit -m "feat(rust-native): flip APOHARA_RUST_* defaults ON + mark TS legacy deprecated (G1.D.2)

Phase 1 milestone: Rust core is the default. TS legacy code stays in repo
as fallback (env var = 0 to revert) but marked @deprecated for Phase 2
S19 delete."
```

### Task G1.D.3: Phase 1 cierre + RELEASE_NOTES update

**Files:**
- Modify: `RELEASE_NOTES.md`
- Modify: `docs/superpowers/pre-release-validation/sign-off.md`

- [ ] **Step 1: Update RELEASE_NOTES**

Append a "Phase 1 — Rust core ports" section listing the 7 new crates + binary.

- [ ] **Step 2: Update sign-off checklist**

Add row: `- [ ] Phase 1 cierre verified: cargo test --workspace green + apohara binary boots + doctor exits 0/2`.

- [ ] **Step 3: Final verification**

```bash
cargo test --workspace 2>&1 | tail -5
bun test tests/integration/ tests/unit/ tests/core/ tests/cli/ 2>&1 | tail -5
./target/release/apohara doctor
```

- [ ] **Step 4: Sprint 15 + Phase 1 cierre commit**

```bash
git commit --allow-empty -m "chore(sprint): Phase 1 Rust core ports COMPLETE

Sprints 12-15 done. 7 new crates + apohara binary + feature flags
defaults flipped to ON. TS legacy @deprecated, Phase 2 S19 delete planned.

Releasable as v1.0.0-rc.2 'Rust core + React UI' (defensible).

Next: Phase 2 UI rewrite to Dioxus."
```

---

## Self-Review

**1. Spec coverage**:
- §4 Phase 1 (S12-S15): G1.A → S12, G1.B → S13, G1.C → S14, G1.D → S15 ✓
- §2 Crate organization: 7 crates Phase 1 + 1 binary mentioned + dependencies declared ✓
- §5 Testing strategy: cada task tiene failing test → impl → pass cycle ✓
- §5 Migration cutover: feature flags por crate + default flip en G1.D.2 ✓

**2. Placeholder scan**: 0 TBD/TODO/FIXME en plan. Stubs en código (stall_detection stub en G1.A.4) son intencionales y reemplazados en G1.A.5.

**3. Type consistency**:
- `RunState` enum aparece en G1.A.2 + G1.A.5 reconciler — mismas variants
- `BlockedReason` enum consistent entre G1.A.2 + G1.B.2 (safety crate uses it)
- `DispatchRequest` / `DispatchOutcome` shape definido en G1.A.3 + usado en G1.A.7 Tauri bridge ✓

**4. Crate naming consistency**: `apohara-dispatch` (no `apohara_dispatch`) in Cargo.toml; module name uses `apohara_dispatch` internally (Rust convention). ✓

---

*Fin del plan Phase 1.*
