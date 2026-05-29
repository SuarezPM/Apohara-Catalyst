# Apohara — Agent Navigation Guide

> Concise navigation for AI coding agents working in this repository.
> For day-to-day engineering contract, see `CLAUDE.md` (symlinked here).

## Build & test commands

| Task | Command |
|---|---|
| Build all crates | `cargo build --workspace` |
| Run `apohara-types` tests | `cargo test -p apohara-types --lib --tests` |
| Run `apohara-indexer` tests | `cargo test -p apohara-indexer` |
| Start desktop dev | `cargo run -p apohara-desktop-dioxus` |
| Generate ts-rs bindings (Rust→TS) | `cargo run -p apohara-types --bin generate_types` |
| Check bindings didn't drift | `cargo test -p apohara-types` (codegen determinism test) |
| Doctor (full env check) | `apohara doctor` |
| Setup verification end-to-end | `apohara verify-setup` |

## Module map

> Status: the workspace is now **37 Rust crates** (`Cargo.toml` `[workspace.members]`) — the table below is a partial Stages 1-10 map; see `Cargo.toml` for the full list. **There is no TypeScript side anymore:** the former `packages/` and `src/core/` TS code was ported to Rust crates during the Dioxus migration (no `packages/`, no `src/`, no `package.json` in the repo). Per-crate `AGENTS.md` files are linked here as they land.

### Rust crates (`crates/`)

| Crate | Responsibility |
|---|---|
| `crates/apohara-types` | Shared types Rust↔TS (ts-rs SSoT, §0.7) |
| `crates/apohara-secrets` | OS-native credential store (keyring-rs) |
| `crates/apohara-pathsafety` | Symlink-escape detection |
| `crates/apohara-audit` | JSONL audit sink + rotation + fchmod 0600 |
| `crates/apohara-notifications` | Cross-platform push notifications |
| `crates/apohara-persistence` | Cross-platform service installer |
| `crates/apohara-worktree` | Git worktree lifecycle (consolidates the previous isolation-engine crate; not yet renamed in this branch) |
| `crates/apohara-coordinator` | Semantic conflict coordinator (slim, delegates state) |
| `crates/apohara-hooks-server` | Agent-hooks HTTP loopback (axum sidecar) |
| `crates/apohara-attention` | Attention bands state machine (HOT/WARM/COOL/IDLE) |
| `crates/apohara-token-accounting` | Token accounting (absolutes > deltas, per-thread) |
| `crates/apohara-mcp-bridge` | Canonical MCP config + per-provider adapters (Claude/Codex/OpenCode dialects) |
| `crates/apohara-event-humanizer` | Provider events → human-readable labels |
| `crates/apohara-anti-thrash` | Strategy rotation tracker (anti-loop) |
| `crates/apohara-indexer` | tree-sitter + sqlite-vec storage + blake3 feature-hashing embeddings |
| `crates/apohara-sandbox` | seccomp-bpf + namespaces sandbox (existing) |

### Surfaces (Rust crates)

The UI is native Rust — there is no `packages/` directory or Node/Bun
toolchain. ts-rs bindings emit per-crate to `crates/<X>/bindings/*.ts`
(do not edit by hand — §0.7).

| Crate | Responsibility |
|---|---|
| `crates/apohara-desktop-dioxus` | Dioxus 0.7 native desktop UI (TaskBoard, Plans, Permissions, Verification timeline). No webview, no Electron. |
| `crates/apohara-tui` | ratatui terminal UI (Dashboard, AgentList, CostTable, config wizard) |
| `crates/apohara` | `apohara` CLI (`doctor`, `verify-setup`, `plan`, …) |

### Former TypeScript domains (now Rust crates)

The orchestration / safety / spec / mcp / providers / hooks / decomposer / verification / persistence / anti-thrash / cli domains were TypeScript under `src/core/` before the Dioxus migration. They now live as Rust crates — e.g. `apohara-coordinator` + `apohara-dispatch` (orchestration + provider drivers), `apohara-safety`, `apohara-spec`, `apohara-mcp` (+ `apohara-mcp-bridge`), `apohara-hooks` (+ `apohara-hooks-server`), `apohara-decomposer`, `apohara-verification`, `apohara-persistence`, `apohara-anti-thrash`, and the `apohara` CLI. See the crate tables above and `Cargo.toml` for the full set. **No `src/` TypeScript tree remains in the repo.**

## Spec source of truth

`docs/superpowers/specs/2026-05-21-apohara-v1-design.md` — read it before non-trivial changes.

## Plan source of truth

`docs/superpowers/plans/2026-05-22-apohara-v1.md` — task-by-task implementation plan.

## Indexer testing (post-Sprint-8)

`cargo test -p apohara-indexer` corre todos los binarios en paralelo sin OOM
hazard. El indexer usa sqlite-vec para storage y feature-hashing (blake3) para
embeddings — ambos in-process, ~0 RAM, deterministas.

Si en el futuro re-introduces un modelo transformer (e.g. `fastembed-rs`),
documenta el footprint y vuelve al patrón "una test binary a la vez" si supera
~100MB en RAM total.

## Cross-cutting disciplines (spec §0)

Before making changes, review the 33 disciplines in `docs/superpowers/specs/2026-05-21-apohara-v1-design.md#0-disciplinas-transversales`. They are NOT suggestions — they're guardrails that prevent entire bug classes.

Highlights:
- §0.1 Centralized IPC listeners (never per-component)
- §0.4 Env sanitization on all spawns (no API keys to subprocesses)
- §0.7 ts-rs Single Source of Truth (never hand-edit the generated per-crate `crates/<X>/bindings/*.ts`; regenerate via `cargo run -p apohara-types --bin generate_types`)
- §0.8 Atomic file writes (mkstemp + rename)
- §0.14 Token accounting: absolutes > deltas
- §0.16 enum_dispatch instead of `Box<dyn>` for providers

## What NOT to do

- **Do NOT** hand-edit the generated ts-rs bindings (`crates/<X>/bindings/*.ts`) — regenerate via `cargo run -p apohara-types --bin generate_types`
- **Do NOT** commit to `main` directly — open a PR (this is a public repo from Stage 11 onwards)
- **Do NOT** add OAuth flows for providers — CLI wrappers only (Pablo's hard rule: TOS prohibits programmatic OAuth for several providers; agents like Anthropic explicitly blocked from OAuth-based wrapping).
- **Do NOT** add providers to the active roster beyond `claude-code-cli`, `codex-cli`, `opencode-go` — others are LEGACY behind `APOHARA_LEGACY_PROVIDERS=1`

---

## Past incidents (rules earned the hard way)

Each rule below cost real time / money / trust to find. Treat them as load-bearing — breaking one regresses Apohara, and the audit history is recorded so the *why* survives even when the original engineer doesn't. (Nimbalyst's CLAUDE.md inspired this section — their published incident write-ups cited real session IDs and dollar costs; ours cite the commit + the symptom.)

### **NEVER pass `process.env` to a CLI subprocess unsanitized**

**Why:** The pre-`33d6901` `src/providers/cli-driver.ts` did `env: { ...process.env }` on every spawn. That leaked `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, AWS / GCP / Azure creds, `GITHUB_TOKEN`, etc. into every wrapped CLI. Two compound failures from this:

  1. **The "wrong account billed" trap** (nimbalyst's published incident): the CLI sees a key in its env and routes to *that* account instead of the user's logged-in CLI session — surprise billing on someone else's plan.
  2. **The claude CLI hang at 120 s**: two concurrent `claude` invocations from the same Bun process both inherited the same `~/.claude/` paths via env + got the same workspace state, then contended on the CLI's internal file locks. The second one hung until our 120 s SIGKILL.

**The rule:** ALL spawns route env through `sanitizeEnv()` from `src/core/persistence/envSanitizer.ts`. Allowlist only `APOHARA_*` and known-safe vars (`PATH`, `HOME`, `USER`, `LANG`, `TERM`, `TMPDIR`). The Rust sandbox runner does the equivalent in `crates/apohara-sandbox/src/runner/imp.rs::build_sanitized_env()`. Adding a new spawn site? Use `sanitizeEnv` or it gets caught in code review.

### **`fs.watch` on Linux only fires for the TEMP filename when the writer does atomic-rename**

**Why:** The first cut of `src/core/dispatch/result-watcher.ts` listened for `fs.watch` events naming `<taskId>.json`. The dispatcher writes results via `atomicWriteFile` (tmp + rename). Linux's inotify reports the event for the **tmp filename**, not the renamed target. Result: the watcher heard the rename but matched on the wrong filename and ignored it. The UI saw "Done (0)" forever even though the result file existed on disk.

**The rule:** Watchers on directories where atomic writes land MUST treat every event as "something changed, rescan" — not "the named file appeared". Use `readdir` on every watch tick. Pair fs.watch with a 1-second polling backup so flaky inotify (NFS, FUSE, some Bun versions) never strands a result. See `result-watcher.ts:80-110` for the pattern.

### **Every spawn site must serialize per-binary OR contend on CLI-internal locks**

**Why:** Pablo hit `claude-code-cli: CLI driver timed out after 120000 ms` once per UI run. Root cause: `claude` keeps per-process state under `~/.claude/` (auth tokens, history, session locks). Two concurrent `claude` children from the same Bun process contended on those locks and the second one blocked until 120 s timeout SIGKILLed it.

**The rule:** `src/providers/cli-driver.ts::runSerialized(binary, task)` queues calls FIFO per binary name. Any new CLI you add via `BUILTIN_CLI_DRIVERS` inherits the queue automatically. Do not bypass it.

### **`bash -c "echo X"` does NOT reliably flush stdout through a PTY**

**Why:** When wiring T2.1 (PTY embedding), the tests using `sh -c "sleep 0.05 && echo replay-test"` exited cleanly with code 0 but produced ZERO bytes in the replay buffer. Verified empirically against node-pty 1.1 + Bun 1.3: `bash -c "echo X"` exits before flushing; `/bin/echo X` is the stable case.

**The rule:** Tests that need to observe PTY output use `/bin/echo` directly or write to a long-running child via `writePty`. The PTY data path itself works (production `/api/run` flows through it just fine) — the issue is exclusively bash startup + immediate-exit timing.

### **opencode reads `opencode.jsonc` at the workspace root, NEVER `.opencode/settings.json`**

**Why:** The pre-T2.4 `mcpInjection.ts::injectOpenCode` wrote `<workspace>/.opencode/settings.json` because that's where Apohara's `agent-config.ts::hookConfigPath` (also wrong) pointed. opencode 1.15+ doesn't look at that path. Our MCP injection landed in `/dev/null` for the entire opencode-go provider.

**The rule:** Provider config paths come from the UPSTREAM CLI's source, not from convention. Verify against the reference repo each release: `reference/opencode/packages/opencode/src/config/config.ts:340` for opencode, `reference/orca/src/main/agent-trust-presets.ts` for cursor / copilot / codex. When the CLI changes its config discovery, our injection must follow.

### **Generated files MUST come back through `bun run generate-types` after every Rust schema change**

**Why:** Pre-`dfad239`, `crates/apohara-types/src/bin/generate_types.rs` was a stub that only wrote a header. Every `bun run generate-types` invocation silently overwrote `packages/apohara-shared/types.ts` with the stub — the §0.7 SSoT was a no-op, and Rust↔TS drift was undetectable. CI's `generate-types:check` only proved the stub matched itself.

**The rule:** When you add `#[derive(TS)]` anywhere, run `bun run generate-types` and commit the regenerated `packages/apohara-shared/types.ts` in the SAME commit. Do not hand-edit the generated file. The CI check will block merges that drift.

---

*This document is auto-loaded by Claude Code / Codex / OpenCode via `CLAUDE.md` symlink.*
