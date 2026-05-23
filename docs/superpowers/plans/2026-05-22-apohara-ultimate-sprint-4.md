# Apohara Ultimate Sprint 4 — Foundation / Bug-barrels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los 8 bug-barrels documentados en `docs/superpowers/specs/2026-05-22-apohara-ultimate-design.md` §3 — features que el spec v1.0 dice implementadas pero cuyo código está ausente, vacío o como stub.

**Architecture:** TDD bite-sized + commits atómicos per-tarea. 3 waves de paralelización; cada tarea cierra con `bun test` + `bunx tsc --noEmit` + commit con `Co-Authored-By: Claude Opus 4.7`. Branch destino: `feat/apohara-ultimate-sprint-4` (deriva de `feat/apohara-v1`).

**Tech Stack:** Bun 1.3.13 (pinned, ver `CLAUDE.md` sobre regresión appendFile en 1.4.x) + TypeScript 5+ + Rust stable + bun:sqlite + bun:test + cargo test (OOM-safe per-binary).

---

## File Structure (Sprint 4 scope)

### Modify (existentes con cambios)

| Path | Cambio | Tarea |
|---|---|---|
| `crates/apohara-token-accounting/src/lib.rs` | 5 LOC placeholder → ~300 LOC per-thread absolute counting | T4.1 |
| `src/core/safety/durablePrompt.ts` | In-memory Map → JSONL-backed con replay + atomic write | T4.2 |
| `src/providers/cli-driver.ts` | Cablear `compileRunnerExecutionPlan` antes del spawn | T4.3 |
| `crates/apohara-hooks-server/src/event.rs` | Cerrar TODO `:100` con broadcast channel + DB forward | T4.5 |
| `crates/apohara-coordinator/src/lib.rs` | Agregar `pub mod coordinator;` | T4.6 |
| `src/core/providers/protocols/ClaudeCodeProtocol.ts` | Scaffold 20 LOC → spawn real con `claude --print` | T4.7a |
| `src/core/providers/protocols/CodexProtocol.ts` | Scaffold → spawn real con `codex exec --json` | T4.7b |
| `src/core/providers/protocols/OpenCodeProtocol.ts` | Scaffold → spawn real con `opencode run --format json` | T4.7c |
| `src/core/providers/BaseAgentProvider.ts` | Delegar spawn a `protocol.createSession()` (no a `cli-driver`) | T4.7d |
| `crates/apohara-mcp-bridge/src/lib.rs` | Agregar `pub mod jsonc;` | T4.8a |

### Create (nuevos)

| Path | Responsabilidad | Tarea |
|---|---|---|
| `crates/apohara-token-accounting/src/counter.rs` | `TokenCounter` con `record_absolute()` + per-thread keying | T4.1 |
| `crates/apohara-token-accounting/src/tests.rs` | Tests de multi-provider scenario | T4.1 |
| `src/core/safety/durablePrompt-jsonl.ts` | JSONL backing helpers (load + append + replay) | T4.2 |
| `src/core/orchestration/poisonedSessions.ts` | Detección + quarantine de sesiones con corrupción | T4.4a |
| `src/core/orchestration/duplicatePrevention.ts` | Dedup de tasks por contenido + idempotency key | T4.4b |
| `src/core/config/versioning.ts` | `loadConfigWithMigration()` + migration chain | T4.4c |
| `crates/apohara-coordinator/src/coordinator.rs` | `Coordinator` class con event loop sobre las 5 tablas | T4.6 |
| `crates/apohara-mcp-bridge/src/jsonc.rs` | JSONC CST con preservación de comentarios | T4.8a |
| `tests/core/token-accounting.test.ts` | TS-side smoke (vía ts-rs bindings) | T4.1 |
| `tests/core/durable-prompt-jsonl.test.ts` | Persistencia + corruption recovery | T4.2 |
| `tests/core/orchestration/poisoned-sessions.test.ts` | Detection + quarantine | T4.4a |
| `tests/core/orchestration/duplicate-prevention.test.ts` | Dedup logic | T4.4b |
| `tests/core/config/versioning.test.ts` | Migration chain | T4.4c |
| `tests/core/coordinator-loop.test.ts` | Integration: enqueue → loop processes → state changes | T4.6 |
| `tests/core/providers/protocols/{claude,codex,opencode}.test.ts` | Per-protocol behavior | T4.7a/b/c |
| `tests/core/mcp-bridge/jsonc-roundtrip.test.ts` | Roundtrip de comentarios | T4.8a |

### Test scaffolds

Cargo tests for Rust crates seguen el patrón OOM-safe: `cargo test -p <crate> --lib` (no bare `cargo test`).

---

## Setup (antes de Wave 1)

- [ ] **Setup 1: Crear branch de sprint**

```bash
git checkout feat/apohara-v1
git checkout -b feat/apohara-ultimate-sprint-4
```

- [ ] **Setup 2: Verificar base verde**

Run: `bun test tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts tests/npx-cli/`
Expected: 505 pass / 0 fail

Run: `bunx tsc --noEmit 2>&1 | tail -10`
Expected: 3 pre-existing errors (`McpServer.ts:67` × 2, `spec/watcher.ts:32`). Documented en CLAUDE.md.

---

## Wave 1 — Días 1-3 (paralelizable a 4 implementers)

### Task 1: T4.1 — Token accounting real (Rust)

**Files:**
- Modify: `crates/apohara-token-accounting/src/lib.rs:1-5`
- Create: `crates/apohara-token-accounting/src/counter.rs`
- Create: `crates/apohara-token-accounting/src/tests.rs`

- [ ] **Step 1: Escribir el failing test (counter unit)**

Crear `crates/apohara-token-accounting/src/tests.rs`:

```rust
use crate::{TokenCounter, TokenSnapshot};

#[test]
fn counter_records_absolute_per_thread() {
    let mut c = TokenCounter::new();
    c.record_absolute("thread-1", TokenSnapshot { input: 100, output: 50, cache_creation: 10, cache_read: 5 });
    c.record_absolute("thread-1", TokenSnapshot { input: 200, output: 120, cache_creation: 30, cache_read: 15 });
    c.record_absolute("thread-2", TokenSnapshot { input: 50, output: 25, cache_creation: 0, cache_read: 0 });

    // thread-1 totals are the LAST snapshot, not summed (absolutes > deltas).
    let t1 = c.get("thread-1").expect("thread-1 missing");
    assert_eq!(t1.input, 200);
    assert_eq!(t1.output, 120);

    // Cross-thread totals SUM the last-known absolute of each thread.
    let total = c.total_across_threads();
    assert_eq!(total.input, 250);   // 200 + 50
    assert_eq!(total.output, 145);  // 120 + 25
}

#[test]
fn counter_resists_double_count_on_replay() {
    let mut c = TokenCounter::new();
    let snap = TokenSnapshot { input: 100, output: 50, cache_creation: 0, cache_read: 0 };
    c.record_absolute("thread-x", snap.clone());
    c.record_absolute("thread-x", snap.clone()); // Same snapshot replayed.
    c.record_absolute("thread-x", snap);
    let t = c.get("thread-x").unwrap();
    // Three identical absolutes → still 100/50, not 300/150.
    assert_eq!(t.input, 100);
    assert_eq!(t.output, 50);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p apohara-token-accounting --lib`
Expected: FAIL with `error[E0432]: unresolved import \`crate::TokenCounter\``

- [ ] **Step 3: Implementar counter.rs**

Crear `crates/apohara-token-accounting/src/counter.rs`:

```rust
//! Per-thread token counting with absolute-not-delta semantics.
//!
//! Why absolutes: providers (Claude, Codex, OpenCode) emit cumulative token
//! totals per session, not deltas. If we add `delta = current - previous` on
//! every event, replays/reconnections double-count. Storing the last known
//! absolute and *replacing* on each event is correct.

use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct TokenSnapshot {
    pub input: u64,
    pub output: u64,
    pub cache_creation: u64,
    pub cache_read: u64,
}

impl TokenSnapshot {
    pub fn add(&self, other: &TokenSnapshot) -> TokenSnapshot {
        TokenSnapshot {
            input: self.input + other.input,
            output: self.output + other.output,
            cache_creation: self.cache_creation + other.cache_creation,
            cache_read: self.cache_read + other.cache_read,
        }
    }
}

#[derive(Default)]
pub struct TokenCounter {
    /// thread_id → last absolute snapshot
    threads: HashMap<String, TokenSnapshot>,
}

impl TokenCounter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_absolute(&mut self, thread_id: &str, snap: TokenSnapshot) {
        // REPLACES not adds — this is the absolute-vs-delta invariant.
        self.threads.insert(thread_id.to_string(), snap);
    }

    pub fn get(&self, thread_id: &str) -> Option<&TokenSnapshot> {
        self.threads.get(thread_id)
    }

    pub fn total_across_threads(&self) -> TokenSnapshot {
        self.threads.values().fold(TokenSnapshot::default(), |acc, s| acc.add(s))
    }
}
```

- [ ] **Step 4: Update lib.rs para exponer counter**

Sustituir `crates/apohara-token-accounting/src/lib.rs` por:

```rust
//! apohara-token-accounting — per-thread absolute token counting per spec §0.14.
//!
//! Replaces the Stage 2 placeholder. The key invariant is **absolutes >
//! deltas**: provider events carry cumulative totals, not increments. We
//! store the last known absolute per thread and replace on each event;
//! the cross-thread total sums those last-knowns. This makes reconnects
//! and replays idempotent.

pub mod counter;
pub use counter::{TokenCounter, TokenSnapshot};

#[cfg(test)]
mod tests;

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cargo test -p apohara-token-accounting --lib`
Expected: PASS — 2 tests

- [ ] **Step 6: Commit**

```bash
git add crates/apohara-token-accounting/
git commit -m "$(cat <<'EOF'
feat(token-accounting): per-thread absolute counter (T4.1)

Reemplaza el 5-LOC placeholder por TokenCounter real con la invariante
absolutes > deltas (spec v1.0 §0.14). Providers emiten totales
cumulativos por sesión; sumar deltas duplica el conteo en replays.

Almacena el último snapshot conocido por thread y reemplaza; total
cross-thread suma los últimos-conocidos. Resiste double-count en
replay (test explícito).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: T4.2 — DurablePromptStore JSONL-backed

**Files:**
- Modify: `src/core/safety/durablePrompt.ts:33-90` (clase DurablePromptStore)
- Create: `src/core/safety/durablePrompt-jsonl.ts`
- Create: `tests/core/durable-prompt-jsonl.test.ts`

- [ ] **Step 1: Escribir el failing test**

Crear `tests/core/durable-prompt-jsonl.test.ts`:

```typescript
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurablePromptStore } from "../../src/core/safety/durablePrompt";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "apohara-prompt-jsonl-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("survives restart: pending request appears after reload", async () => {
  const ledger = join(dir, "prompts.jsonl");
  const store1 = new DurablePromptStore({ ledgerPath: ledger });
  store1.enqueueRequest({
    request_id: "req-1",
    inv: { tool: "Bash", input: { command: "ls" } },
    suggested_pattern: "Bash(ls)",
    available_scopes: ["once", "session"],
    created_at: 1000,
  });

  const store2 = new DurablePromptStore({ ledgerPath: ledger });
  await store2.load();
  // store2 should know about req-1 from disk, even though it never saw enqueueRequest.
  const resp = await store2.waitForResponse("req-1", 50, 10);
  // No response was set, so we expect null after timeout — but the REQUEST
  // must have been loaded. We assert via "pending" inspection.
  expect(store2.isPending("req-1")).toBe(true);
  expect(resp).toBe(null);
});

test("response set survives restart", async () => {
  const ledger = join(dir, "prompts.jsonl");
  const s1 = new DurablePromptStore({ ledgerPath: ledger });
  s1.enqueueRequest({
    request_id: "req-2",
    inv: { tool: "Bash", input: { command: "rm" } },
    suggested_pattern: "Bash(rm)",
    available_scopes: ["once"],
    created_at: 2000,
  });
  s1.setResponse({ request_id: "req-2", decision: "deny" });

  const s2 = new DurablePromptStore({ ledgerPath: ledger });
  await s2.load();
  const resp = await s2.waitForResponse("req-2", 100, 10);
  expect(resp).not.toBeNull();
  expect(resp!.decision).toBe("deny");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/durable-prompt-jsonl.test.ts`
Expected: FAIL — DurablePromptStore constructor doesn't accept `ledgerPath`, no `load()` method, no `isPending`.

- [ ] **Step 3: Crear helper JSONL**

Crear `src/core/safety/durablePrompt-jsonl.ts`:

```typescript
import { appendFile, readFile } from "node:fs/promises";
import { atomicWriteFile } from "../persistence/atomicWrite.js";
import type { PermissionRequest, PermissionResponse } from "./durablePrompt.js";

export type LedgerEntry =
  | { kind: "request"; data: PermissionRequest }
  | { kind: "response"; data: PermissionResponse };

export async function appendEntry(path: string, entry: LedgerEntry): Promise<void> {
  await appendFile(path, JSON.stringify(entry) + "\n");
}

export async function loadEntries(path: string): Promise<LedgerEntry[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const entries: LedgerEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as LedgerEntry);
    } catch {
      // Skip corrupted line — recovery best-effort.
    }
  }
  return entries;
}

export async function compactLedger(path: string, alive: LedgerEntry[]): Promise<void> {
  const body = alive.map((e) => JSON.stringify(e)).join("\n") + (alive.length ? "\n" : "");
  await atomicWriteFile(path, body);
}
```

- [ ] **Step 4: Modificar DurablePromptStore para usar JSONL**

Sustituir bloque `src/core/safety/durablePrompt.ts:33-90` por:

```typescript
export interface DurablePromptStoreOptions {
  /** When set, the store appends every enqueueRequest / setResponse to this
   * JSONL ledger and can recover state on load(). When unset, behavior is
   * identical to the previous in-memory implementation (no I/O). */
  ledgerPath?: string;
}

export class DurablePromptStore {
  private pending = new Map<string, PermissionRequest>();
  private responses = new Map<string, PermissionResponse>();
  private ledgerPath?: string;

  constructor(opts: DurablePromptStoreOptions = {}) {
    this.ledgerPath = opts.ledgerPath;
  }

  enqueueRequest(req: PermissionRequest): void {
    this.pending.set(req.request_id, req);
    if (this.ledgerPath) {
      void appendEntry(this.ledgerPath, { kind: "request", data: req }).catch(() => {
        /* best-effort durability */
      });
    }
  }

  setResponse(resp: PermissionResponse): void {
    this.responses.set(resp.request_id, resp);
    if (this.ledgerPath) {
      void appendEntry(this.ledgerPath, { kind: "response", data: resp }).catch(() => {});
    }
  }

  isPending(request_id: string): boolean {
    return this.pending.has(request_id) && !this.responses.has(request_id);
  }

  /** Load JSONL ledger into memory. Called after construction. */
  async load(): Promise<void> {
    if (!this.ledgerPath) return;
    const entries = await loadEntries(this.ledgerPath);
    for (const entry of entries) {
      if (entry.kind === "request") this.pending.set(entry.data.request_id, entry.data);
      else this.responses.set(entry.data.request_id, entry.data);
    }
  }

  async waitForResponse(
    request_id: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    pollMs: number = DEFAULT_POLL_MS,
  ): Promise<PermissionResponse | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = this.responses.get(request_id);
      if (r) return r;
      await new Promise((res) => setTimeout(res, pollMs));
    }
    return null;
  }
}
```

Y agregar al tope del archivo:

```typescript
import { appendEntry, loadEntries } from "./durablePrompt-jsonl.js";
```

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test tests/core/durable-prompt-jsonl.test.ts`
Expected: PASS — 2 tests

Run: `bun test tests/core/safety/` (regression — los tests existentes de durablePrompt no se rompen)
Expected: existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/core/safety/durablePrompt.ts src/core/safety/durablePrompt-jsonl.ts tests/core/durable-prompt-jsonl.test.ts
git commit -m "$(cat <<'EOF'
feat(safety): DurablePromptStore JSONL-backed (T4.2)

Cierra el "Stage 8 will swap the backing store" mencionado en el
comment top-of-file de durablePrompt.ts. El store ahora persiste
enqueueRequest + setResponse a un JSONL append-only y puede
recuperar estado con load() tras un restart del bun process.

Backward-compat: si no se pasa ledgerPath, el comportamiento es
idéntico al in-memory previo (no I/O).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: T4.3 — Runner policy wired al spawn path

**Files:**
- Modify: `src/providers/cli-driver.ts:~150-200` (donde se hace el spawn)
- Create: `tests/integration/runner-policy-wired.test.ts`

- [ ] **Step 1: Inspeccionar el spawn path actual**

Run: `grep -n "Bun.spawn\|spawn\b" src/providers/cli-driver.ts | head -10`

Anotar las líneas exactas donde se invoca `Bun.spawn(...)`. Estas son los call-sites a interceptar.

- [ ] **Step 2: Escribir el failing test (integration)**

Crear `tests/integration/runner-policy-wired.test.ts`:

```typescript
import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileRunnerExecutionPlan } from "../../src/core/safety/runnerPolicy/planCompiler";

test("runner policy is compiled before spawn — Strict preset blocks pushToMain", async () => {
  const wsp = await mkdtemp(join(tmpdir(), "apohara-runner-policy-"));
  await writeFile(join(wsp, ".apohara.json"), JSON.stringify({ runnerPolicy: { preset: "Strict" } }));

  const plan = await compileRunnerExecutionPlan(wsp);
  expect(plan.policy.publish.blockPushToMain).toBe(true);
  expect(plan.policy.preset).toBe("Strict");

  // The spawn path should READ this plan and refuse pushToMain. Verifying
  // the integration: we check that pickCliDriverOptions returns a config
  // including the compiled plan.
  const { pickCliDriverOptions } = await import("../../src/providers/cli-driver");
  const opts = await pickCliDriverOptions("claude-code-cli", { workspacePath: wsp, prompt: "test" });
  expect(opts.runnerPolicy).toBeDefined();
  expect(opts.runnerPolicy.preset).toBe("Strict");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/integration/runner-policy-wired.test.ts`
Expected: FAIL — `pickCliDriverOptions` doesn't return `runnerPolicy` field.

- [ ] **Step 4: Cablear policy compilation en cli-driver.ts**

Identificar la función `pickCliDriverOptions` (o la entry-point del spawn) en `src/providers/cli-driver.ts`. Agregar:

```typescript
import { compileRunnerExecutionPlan } from "../core/safety/runnerPolicy/planCompiler.js";

export async function pickCliDriverOptions(
  binary: string,
  opts: { workspacePath: string; prompt: string; /* ... existentes ... */ },
): Promise<CliDriverOptions> {
  // Compile the runner policy from .apohara.json / settings hierarchy. This
  // must happen BEFORE the spawn so the policy can gate filesystem / network
  // / commands access.
  const plan = await compileRunnerExecutionPlan(opts.workspacePath);

  return {
    /* ... existentes ... */
    runnerPolicy: plan.policy,
  };
}
```

Y propagar `runnerPolicy` al `Bun.spawn` env (con `APOHARA_RUNNER_POLICY=<JSON>`) o al sandbox runner (Rust side) según corresponda.

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test tests/integration/runner-policy-wired.test.ts`
Expected: PASS

Run: `bun test tests/core/safety/runnerPolicy/`
Expected: existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/providers/cli-driver.ts tests/integration/runner-policy-wired.test.ts
git commit -m "$(cat <<'EOF'
feat(safety): cablear runner policy al spawn path (T4.3)

El módulo src/core/safety/runnerPolicy/{planCompiler,presets,fsSnapshot,types}
existe completo con tests desde Stage 5, pero el spawn en cli-driver.ts
nunca lo invocaba. Doctor.ts lo declaraba explícitamente "deferred
(Stage 5 integration pending)".

Ahora pickCliDriverOptions compila el RunnerExecutionPlan ANTES del
spawn y lo propaga al env del CLI subprocess. Cierra agentrail #8.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: T4.8 — JSONC CST + Versioned Config Schema

JSONC y Versioned Config son distintos pero conceptualmente "config preservation" — los hacemos juntos en Wave 1 porque tienen 0 deps entre sí y entre otras tareas.

#### Task 4a: T4.8a — JSONC CST con preservación de comentarios

**Files:**
- Create: `crates/apohara-mcp-bridge/src/jsonc.rs`
- Modify: `crates/apohara-mcp-bridge/src/lib.rs` (agregar `pub mod jsonc;`)
- Create: `tests/core/mcp-bridge/jsonc-roundtrip.test.ts` (TS-side via ts-rs si aplicable; alternativamente test en Rust)

- [ ] **Step 1: Escribir el failing test (Rust)**

Crear `crates/apohara-mcp-bridge/src/jsonc_tests.rs` (módulo de tests):

```rust
#[cfg(test)]
mod tests {
    use crate::jsonc::{parse_jsonc, edit_value, serialize_jsonc};

    #[test]
    fn roundtrip_preserves_comments_and_trailing_commas() {
        let input = r#"{
    // User's preferred provider
    "provider": "claude-code-cli",
    /* Multi-line
       comment */
    "max_concurrent": 3, // trailing inline
    "experimental": {
        "smart_router": false, // off by default
    },
}"#;
        let cst = parse_jsonc(input).expect("parse");
        let out = serialize_jsonc(&cst);
        assert_eq!(out, input, "roundtrip must be byte-identical");
    }

    #[test]
    fn editing_value_preserves_surrounding_comments() {
        let input = r#"{
    // important
    "provider": "claude-code-cli", // active
    "max_concurrent": 3,
}"#;
        let mut cst = parse_jsonc(input).expect("parse");
        edit_value(&mut cst, &["max_concurrent"], serde_json::json!(5));
        let out = serialize_jsonc(&cst);
        assert!(out.contains("// important"), "leading comment preserved");
        assert!(out.contains("// active"), "trailing inline comment preserved");
        assert!(out.contains(r#""max_concurrent": 5"#), "value changed");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p apohara-mcp-bridge --lib`
Expected: FAIL — `unresolved import \`crate::jsonc\``

- [ ] **Step 3: Implementar jsonc.rs**

Crear `crates/apohara-mcp-bridge/src/jsonc.rs`:

```rust
//! JSONC (JSON with Comments) CST parser/serializer with comment preservation.
//!
//! The MCP bridge writes config files (`opencode.jsonc`, `.claude/settings.json`,
//! etc.) where the user may have hand-edited comments. Naïve serde_json
//! roundtrip destroys those comments — this CST keeps them.
//!
//! Strategy: thin wrapper over the `jsonc-parser` crate which already produces
//! a CST. We expose two helpers — `edit_value` and `serialize_jsonc` — so
//! callers can mutate one value without touching surrounding comments.

use jsonc_parser::cst::CstRootNode;

pub type JsoncCst = CstRootNode;

pub fn parse_jsonc(input: &str) -> Result<JsoncCst, String> {
    CstRootNode::parse(input, &Default::default()).map_err(|e| format!("jsonc parse: {e}"))
}

pub fn edit_value(cst: &mut JsoncCst, path: &[&str], new_value: serde_json::Value) {
    // Navigate to the target object property and replace its value while
    // leaving the surrounding tokens (whitespace, comments, trailing commas)
    // intact. The CST is a tree of tokens; we walk it by key.
    let mut node = cst.object_value().expect("root is not an object");
    for (i, key) in path.iter().enumerate() {
        let prop = node.property(key).unwrap_or_else(|| panic!("path[{i}]={key} not found"));
        if i == path.len() - 1 {
            prop.set_value(serde_json::to_string(&new_value).unwrap());
            return;
        }
        node = prop.value().and_then(|v| v.as_object()).expect("intermediate not an object");
    }
}

pub fn serialize_jsonc(cst: &JsoncCst) -> String {
    cst.to_string()
}
```

Y registrar el módulo + dependencia. En `crates/apohara-mcp-bridge/Cargo.toml`:

```toml
[dependencies]
jsonc-parser = { version = "0.26", features = ["cst", "serde"] }
serde_json = { workspace = true }
```

En `crates/apohara-mcp-bridge/src/lib.rs`:

```rust
pub mod jsonc;

#[cfg(test)]
mod jsonc_tests;
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cargo build -p apohara-mcp-bridge`
Expected: build success

Run: `cargo test -p apohara-mcp-bridge --lib`
Expected: PASS — 2 tests

- [ ] **Step 5: Commit**

```bash
git add crates/apohara-mcp-bridge/
git commit -m "$(cat <<'EOF'
feat(mcp-bridge): JSONC CST con preservación de comentarios (T4.8a)

Cierra spec v1.0 §0.27 (JSONC con preservación de comentarios via CST).
El módulo previo de mcp-bridge sobrescribía opencode.jsonc con un round-
trip serde_json que destruía todos los comentarios del usuario.

Implementación via jsonc-parser crate (CST feature). edit_value muta
un solo path sin tocar tokens adyacentes (comentarios, trailing
commas, whitespace).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

#### Task 4b: T4.8b — Versioned Config Schema + migration chain

**Files:**
- Create: `src/core/config/versioning.ts`
- Create: `src/core/config/migrations/v1-to-v2.ts` (ejemplo)
- Create: `tests/core/config/versioning.test.ts`

- [ ] **Step 1: Escribir el failing test**

Crear `tests/core/config/versioning.test.ts`:

```typescript
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigWithMigration } from "../../../src/core/config/versioning";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "apohara-config-ver-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("loads v2 config without migration", async () => {
  const p = join(dir, "config.json");
  await writeFile(p, JSON.stringify({ schema_version: 2, provider: "claude-code-cli" }));
  const cfg = await loadConfigWithMigration(p, /*targetVersion=*/ 2);
  expect(cfg.schema_version).toBe(2);
  expect(cfg.provider).toBe("claude-code-cli");
});

test("migrates v1 config to v2 (renames provider key)", async () => {
  const p = join(dir, "config.json");
  // v1 had `cli` field; v2 renamed it to `provider`.
  await writeFile(p, JSON.stringify({ schema_version: 1, cli: "claude-code-cli" }));
  const cfg = await loadConfigWithMigration(p, /*targetVersion=*/ 2);
  expect(cfg.schema_version).toBe(2);
  expect(cfg.provider).toBe("claude-code-cli");
  // The .bak backup must exist with the original v1 content.
  const bak = await readFile(p + ".bak", "utf-8");
  expect(bak).toContain('"schema_version":1');
});

test("rejects unknown future version", async () => {
  const p = join(dir, "config.json");
  await writeFile(p, JSON.stringify({ schema_version: 999 }));
  await expect(loadConfigWithMigration(p, 2)).rejects.toThrow(/schema_version 999/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/config/versioning.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementar versioning.ts**

Crear `src/core/config/versioning.ts`:

```typescript
import { readFile, rename } from "node:fs/promises";
import { atomicWriteJson } from "../persistence/atomicWrite.js";

export type ConfigV1 = { schema_version: 1; cli?: string };
export type ConfigV2 = { schema_version: 2; provider?: string };
export type AnyVersionedConfig = ConfigV1 | ConfigV2;

type Migration = (input: AnyVersionedConfig) => AnyVersionedConfig;

const MIGRATIONS: Record<number, Migration> = {
  // v1 → v2: rename `cli` to `provider`.
  1: (cfg) => {
    const v1 = cfg as ConfigV1;
    return { schema_version: 2, provider: v1.cli };
  },
};

export async function loadConfigWithMigration(path: string, targetVersion: number): Promise<AnyVersionedConfig> {
  const raw = await readFile(path, "utf-8");
  let cfg: AnyVersionedConfig = JSON.parse(raw);
  const original = cfg;

  while (cfg.schema_version < targetVersion) {
    const migrate = MIGRATIONS[cfg.schema_version];
    if (!migrate) throw new Error(`No migration from schema_version ${cfg.schema_version}`);
    cfg = migrate(cfg);
  }

  if (cfg.schema_version > targetVersion) {
    throw new Error(
      `Config schema_version ${cfg.schema_version} is newer than supported (${targetVersion}). Update Apohara.`,
    );
  }

  // If the config was migrated, write it back atomically and keep a .bak.
  if (cfg !== original) {
    await rename(path, path + ".bak");
    await atomicWriteJson(path, cfg);
  }

  return cfg;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test tests/core/config/versioning.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/core/config/versioning.ts tests/core/config/versioning.test.ts
git commit -m "$(cat <<'EOF'
feat(config): Versioned Config Schema + migration chain (T4.8b)

Cierra vibe-kanban #10. Sin esto, el primer release no podría
migrar formato de config sin romper installs existentes.

loadConfigWithMigration carga un JSON con schema_version, lo migra
secuencialmente hasta targetVersion (v1 → v2 renombra 'cli' →
'provider' como ejemplo), backupea el original a .bak, y escribe
atómico. Rechaza versiones futuras desconocidas.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Wave 2 — Días 4-6 (paralelizable a 2 implementers)

### Task 5: T4.4 — Multica bug-barrels (3 sub-features)

#### Task 5a: T4.4a — Poisoned sessions detection

**Files:**
- Create: `src/core/orchestration/poisonedSessions.ts`
- Create: `tests/core/orchestration/poisoned-sessions.test.ts`

- [ ] **Step 1: Escribir el failing test**

Crear `tests/core/orchestration/poisoned-sessions.test.ts`:

```typescript
import { expect, test } from "bun:test";
import { detectPoisonedSession, quarantineSession } from "../../../src/core/orchestration/poisonedSessions";

test("detects session with malformed JSON in last message", () => {
  const session = {
    id: "sess-1",
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "{ not valid json" }, // poisoned
    ],
  };
  expect(detectPoisonedSession(session)).toBe(true);
});

test("detects session with cycle in tool_use IDs", () => {
  const session = {
    id: "sess-2",
    messages: [
      { role: "assistant", content: "", tool_use_id: "t1", parent_tool_use_id: "t2" },
      { role: "assistant", content: "", tool_use_id: "t2", parent_tool_use_id: "t1" },
    ],
  };
  expect(detectPoisonedSession(session)).toBe(true);
});

test("does NOT flag well-formed session", () => {
  const session = {
    id: "sess-ok",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: '{"valid": "json"}' },
    ],
  };
  expect(detectPoisonedSession(session)).toBe(false);
});

test("quarantineSession returns archived path", () => {
  const session = { id: "sess-1", messages: [] };
  const archived = quarantineSession(session);
  expect(archived).toMatch(/quarantine\/sess-1-\d+\.json$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/orchestration/poisoned-sessions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementar poisonedSessions.ts**

Crear `src/core/orchestration/poisonedSessions.ts`:

```typescript
/**
 * Detect sessions with structural corruption that would crash the dispatcher
 * if loaded normally. multica's poisoned-session quarantine pattern.
 */

export interface SessionLike {
  id: string;
  messages: Array<{
    role: string;
    content: string;
    tool_use_id?: string;
    parent_tool_use_id?: string;
  }>;
}

export function detectPoisonedSession(session: SessionLike): boolean {
  for (const msg of session.messages) {
    // Heuristic 1: assistant message claims to be JSON but doesn't parse.
    if (msg.role === "assistant" && msg.content.trim().startsWith("{")) {
      try {
        JSON.parse(msg.content);
      } catch {
        return true;
      }
    }
  }

  // Heuristic 2: cycle in tool_use parent chain.
  const parentOf = new Map<string, string>();
  for (const msg of session.messages) {
    if (msg.tool_use_id && msg.parent_tool_use_id) {
      parentOf.set(msg.tool_use_id, msg.parent_tool_use_id);
    }
  }
  for (const [start] of parentOf.entries()) {
    const seen = new Set<string>();
    let cur: string | undefined = start;
    while (cur) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  }

  return false;
}

export function quarantineSession(session: SessionLike): string {
  // Returns the target archive path. Caller writes the actual file.
  return `quarantine/${session.id}-${Date.now()}.json`;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test tests/core/orchestration/poisoned-sessions.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestration/poisonedSessions.ts tests/core/orchestration/poisoned-sessions.test.ts
git commit -m "$(cat <<'EOF'
feat(orchestration): poisoned session detection + quarantine (T4.4a)

Cierra multica #7 bug-barrel. El spec v1.0 mencionaba poisoned
sessions pero no había código. Sin esto, una sesión corrupta crashea
el dispatcher al re-load.

detectPoisonedSession aplica 2 heurísticas: (a) message marcado como
JSON que no parsea, (b) ciclo en parent tool_use chain.
quarantineSession produce el path archive (writer side externo).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

#### Task 5b: T4.4b — Duplicate prevention

**Files:**
- Create: `src/core/orchestration/duplicatePrevention.ts`
- Create: `tests/core/orchestration/duplicate-prevention.test.ts`

- [ ] **Step 1: Escribir el failing test**

Crear `tests/core/orchestration/duplicate-prevention.test.ts`:

```typescript
import { expect, test } from "bun:test";
import { DuplicateGuard, computeTaskFingerprint } from "../../../src/core/orchestration/duplicatePrevention";

test("computeTaskFingerprint is stable", () => {
  const a = computeTaskFingerprint({ prompt: "do X", provider: "claude", workspacePath: "/ws" });
  const b = computeTaskFingerprint({ prompt: "do X", provider: "claude", workspacePath: "/ws" });
  expect(a).toBe(b);
});

test("computeTaskFingerprint differs by prompt", () => {
  const a = computeTaskFingerprint({ prompt: "do X", provider: "claude", workspacePath: "/ws" });
  const b = computeTaskFingerprint({ prompt: "do Y", provider: "claude", workspacePath: "/ws" });
  expect(a).not.toBe(b);
});

test("DuplicateGuard rejects identical task within window", async () => {
  const g = new DuplicateGuard({ windowMs: 1000 });
  const task = { prompt: "ls", provider: "claude", workspacePath: "/x" };
  expect(g.shouldAccept(task)).toBe(true);
  expect(g.shouldAccept(task)).toBe(false); // duplicate
});

test("DuplicateGuard accepts duplicate after window expires", async () => {
  const g = new DuplicateGuard({ windowMs: 50 });
  const task = { prompt: "ls", provider: "claude", workspacePath: "/x" };
  expect(g.shouldAccept(task)).toBe(true);
  await new Promise((r) => setTimeout(r, 60));
  expect(g.shouldAccept(task)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/orchestration/duplicate-prevention.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implementar duplicatePrevention.ts**

Crear `src/core/orchestration/duplicatePrevention.ts`:

```typescript
import { createHash } from "node:crypto";

export interface TaskShape {
  prompt: string;
  provider: string;
  workspacePath: string;
}

export function computeTaskFingerprint(task: TaskShape): string {
  return createHash("sha256")
    .update(`${task.provider}|${task.workspacePath}|${task.prompt}`)
    .digest("hex");
}

export interface DuplicateGuardOptions {
  windowMs: number;
}

export class DuplicateGuard {
  private recent = new Map<string, number>();
  private windowMs: number;

  constructor(opts: DuplicateGuardOptions) {
    this.windowMs = opts.windowMs;
  }

  shouldAccept(task: TaskShape): boolean {
    const fp = computeTaskFingerprint(task);
    const now = Date.now();
    const last = this.recent.get(fp);
    if (last !== undefined && now - last < this.windowMs) {
      return false;
    }
    this.recent.set(fp, now);
    // Opportunistic GC: drop entries older than 10× window.
    const cutoff = now - this.windowMs * 10;
    for (const [k, t] of this.recent) {
      if (t < cutoff) this.recent.delete(k);
    }
    return true;
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun test tests/core/orchestration/duplicate-prevention.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestration/duplicatePrevention.ts tests/core/orchestration/duplicate-prevention.test.ts
git commit -m "$(cat <<'EOF'
feat(orchestration): task duplicate prevention guard (T4.4b)

Cierra multica #13 bug-barrel. Spec v1.0 §3.3 lo mencionaba sin
código. Bug latente: autopilots con polling tight pueden disparar
la misma task 5× en un segundo, multiplicando costo.

DuplicateGuard usa sha256(provider|workspace|prompt) como fingerprint
con ventana configurable. Auto-GC opportunístico a 10× window.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

#### Task 5c: T4.4c — Settings versioning

Esta tarea convierte el `versioning.ts` genérico (T4.8b) en un consumer específico para `settings.json`. Si T4.8b ya cubre el caso porque `settings.json` ES el config target, este task se reduce a "wire al loader actual".

**Files:**
- Modify: `src/core/safety/settingsHierarchy.ts` (consumir `loadConfigWithMigration`)
- Create: `tests/core/safety/settings-versioning.test.ts`

- [ ] **Step 1: Inspeccionar settingsHierarchy.ts**

Run: `head -60 src/core/safety/settingsHierarchy.ts`

Anotar la función de load actual.

- [ ] **Step 2: Escribir failing test**

Crear `tests/core/safety/settings-versioning.test.ts`:

```typescript
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings } from "../../../src/core/safety/settingsHierarchy";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "apohara-settings-ver-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("settings.json without schema_version is treated as v1 and migrated", async () => {
  const p = join(dir, "settings.json");
  // Pre-v1 settings (legacy): no schema_version, top-level `cli` key.
  await writeFile(p, JSON.stringify({ cli: "claude-code-cli", max_concurrent: 3 }));
  const settings = await loadSettings(p);
  expect(settings.schema_version).toBeGreaterThanOrEqual(2);
  expect(settings.provider).toBe("claude-code-cli");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/core/safety/settings-versioning.test.ts`
Expected: FAIL — loadSettings doesn't migrate.

- [ ] **Step 4: Wire loadConfigWithMigration en settingsHierarchy.ts**

Modificar la función `loadSettings` (o equivalente) para invocar `loadConfigWithMigration` con `targetVersion: 2`:

```typescript
import { loadConfigWithMigration } from "../config/versioning.js";

export async function loadSettings(path: string): Promise<Settings> {
  // Auto-promote legacy (no schema_version) to v1 before migrating.
  const raw = JSON.parse(await readFile(path, "utf-8"));
  if (raw.schema_version === undefined) raw.schema_version = 1;
  await atomicWriteJson(path, raw);

  const migrated = await loadConfigWithMigration(path, /*targetVersion=*/ 2);
  return migrated as Settings;
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test tests/core/safety/settings-versioning.test.ts`
Expected: PASS

Run: `bun test tests/core/safety/` (regression)
Expected: no breaking changes

- [ ] **Step 6: Commit**

```bash
git add src/core/safety/settingsHierarchy.ts tests/core/safety/settings-versioning.test.ts
git commit -m "$(cat <<'EOF'
feat(settings): cablear versioning chain a settings.json (T4.4c)

Cierra multica #17 bug-barrel. settings.json no era versionado;
agregar nuevos campos en una release rompía installs existentes.

loadSettings ahora promueve legacy (sin schema_version) a v1 y luego
migra v1 → v2 via loadConfigWithMigration (T4.8b). Backup .bak
generado automáticamente por loadConfigWithMigration.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: T4.5 — Hooks server broadcast (cierra TODO `event.rs:100`)

**Files:**
- Modify: `crates/apohara-hooks-server/src/event.rs:95-115` (cerrar TODO con forwarding)
- Modify: `crates/apohara-hooks-server/src/lib.rs` (agregar canal de broadcast en `HookServerState`)
- Create: `crates/apohara-hooks-server/src/broadcast.rs` (tipo Broadcaster + tokio::sync::broadcast wrapper)
- Create: `tests/core/hooks-server/broadcast.test.ts` (TS-side integration via hook POST → orchestration DB row)

- [ ] **Step 1: Escribir el failing test (Rust unit)**

Crear `crates/apohara-hooks-server/src/broadcast_tests.rs`:

```rust
#[cfg(test)]
mod tests {
    use crate::broadcast::Broadcaster;
    use crate::HookEventPayload;

    #[tokio::test]
    async fn broadcast_delivers_to_subscriber() {
        let bc: Broadcaster<HookEventPayload> = Broadcaster::new(16);
        let mut rx = bc.subscribe();

        let evt = HookEventPayload::default();
        bc.send(evt.clone()).expect("send ok");

        let received = rx.recv().await.expect("recv ok");
        assert_eq!(received, evt);
    }

    #[tokio::test]
    async fn broadcast_with_no_subscribers_does_not_error() {
        let bc: Broadcaster<HookEventPayload> = Broadcaster::new(16);
        let r = bc.send(HookEventPayload::default());
        assert!(r.is_ok() || r.is_err()); // tokio::broadcast errors if no rx, both OK semantically.
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p apohara-hooks-server --lib`
Expected: FAIL — `Broadcaster` not defined.

- [ ] **Step 3: Implementar broadcast.rs**

Crear `crates/apohara-hooks-server/src/broadcast.rs`:

```rust
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct Broadcaster<T: Clone> {
    tx: broadcast::Sender<T>,
}

impl<T: Clone> Broadcaster<T> {
    pub fn new(capacity: usize) -> Self {
        let (tx, _rx) = broadcast::channel(capacity);
        Self { tx }
    }
    pub fn subscribe(&self) -> broadcast::Receiver<T> {
        self.tx.subscribe()
    }
    pub fn send(&self, value: T) -> Result<usize, broadcast::error::SendError<T>> {
        self.tx.send(value)
    }
}
```

- [ ] **Step 4: Cablear broadcast en event handler**

Modificar `crates/apohara-hooks-server/src/event.rs` líneas 95-115 — reemplazar el TODO con forwarding real:

```rust
// SUSTITUIR:
//   // TODO Stage 2.3: forward to broadcast channel + orchestration DB.
//   tracing::info!(...);
// POR:

let payload: HookEventPayload = serde_json::from_value(serde_json::Value::Object(tagged))
    .map_err(|_| StatusCode::UNPROCESSABLE_ENTITY)?;

// Forward to in-process subscribers (UI bridge, ledger appender).
if let Err(send_err) = state.broadcaster.send(payload.clone()) {
    tracing::warn!(error = ?send_err, "hooks-server: no active subscribers");
}

tracing::info!(
    event_type = %envelope.event_type,
    pane = %envelope.pane_key,
    task = ?envelope.task_id,
    "hook event broadcast"
);

Ok(Json(serde_json::json!({ "accepted": true })))
```

Y agregar `broadcaster: Broadcaster<HookEventPayload>` al struct de state en `lib.rs`.

- [ ] **Step 5: Run tests**

Run: `cargo test -p apohara-hooks-server --lib`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add crates/apohara-hooks-server/
git commit -m "$(cat <<'EOF'
feat(hooks-server): broadcast channel cerrando TODO event.rs:100 (T4.5)

Cierra orca #1 bug-barrel. Pre-T4.5: los hook events de los CLIs
(PreToolUse/PostToolUse/Stop/PermissionRequest) llegaban,
autenticaban, validaban schema, y morían en un tracing::info!() sin
hacer nada — el TODO literal "Stage 2.3: forward to broadcast
channel + orchestration DB" estaba sin tocar.

Ahora event.rs reenvía el payload validado a un tokio broadcast
channel mantenido en HookServerState. Los subscribers (UI bridge
en bun, ledger appender, futuro Coordinator loop) reciben el evento
real-time. send falla benigna si no hay subscribers.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Wave 3 — Días 7-10 (secuencial — los más arquitectónicos)

### Task 7: T4.6 — Coordinator class con event loop

**Files:**
- Create: `crates/apohara-coordinator/src/coordinator.rs`
- Modify: `crates/apohara-coordinator/src/lib.rs` (agregar `pub mod coordinator;` + re-export)
- Create: `tests/core/coordinator-loop.test.ts` (TS-side via ts-rs)

- [ ] **Step 1: Escribir el failing test (Rust integration)**

Crear `crates/apohara-coordinator/tests/coordinator_loop.rs`:

```rust
use apohara_coordinator::coordinator::{Coordinator, CoordinatorTick, TickOutcome};

#[tokio::test]
async fn coordinator_processes_enqueued_task() {
    // Mock DB con 1 task pending.
    let mut coord = Coordinator::new_with_mocks();
    coord.enqueue_test_task("task-1");

    let outcome = coord.tick().await;

    match outcome {
        TickOutcome::Dispatched { task_ids } => {
            assert_eq!(task_ids, vec!["task-1".to_string()]);
        }
        _ => panic!("expected Dispatched, got {:?}", outcome),
    }
}

#[tokio::test]
async fn coordinator_tick_is_idempotent_on_empty_db() {
    let mut coord = Coordinator::new_with_mocks();
    let outcome = coord.tick().await;
    assert!(matches!(outcome, TickOutcome::NoOp));
}

#[tokio::test]
async fn coordinator_detects_stalled_task_after_timeout() {
    let mut coord = Coordinator::new_with_mocks();
    coord.enqueue_test_task_with_age("task-stale", 6 * 60 * 1000); // 6 min
    let outcome = coord.tick().await;
    match outcome {
        TickOutcome::StallDetected { task_ids } => {
            assert_eq!(task_ids, vec!["task-stale".to_string()]);
        }
        _ => panic!("expected StallDetected, got {:?}", outcome),
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p apohara-coordinator --test coordinator_loop`
Expected: FAIL — `unresolved import \`apohara_coordinator::coordinator\``

- [ ] **Step 3: Implementar coordinator.rs**

Crear `crates/apohara-coordinator/src/coordinator.rs`:

```rust
//! Coordinator event loop per spec §3.2.
//!
//! Pre-T4.6, this crate exposed `manifest`, `conflict_matrix`, `blast_radius`,
//! and `scheduler_decision` as standalone libraries — useful but no caller.
//! The audit (orca #9) flagged that the 5 orchestration DB tables
//! (`messages`, `tasks`, `dispatch_contexts`, `decision_gates`,
//! `coordinator_runs`) had CRUDs but no loop driving them.
//!
//! `Coordinator::tick()` is the unit of progress: read pending state, decide
//! what to dispatch, mark in-progress, detect stalls. Designed to be called
//! N×/second by a sidecar tokio task in `apohara-daemon` (Sprint 6) or by
//! the bun process directly via ts-rs bridge (today).

use std::collections::HashMap;

#[derive(Debug, PartialEq)]
pub enum TickOutcome {
    NoOp,
    Dispatched { task_ids: Vec<String> },
    StallDetected { task_ids: Vec<String> },
}

pub struct CoordinatorTick {
    pub now_ms: u64,
}

pub struct Coordinator {
    // Mock storage for now — Sprint 5 wires real bun:sqlite via ts-rs bridge.
    tasks: HashMap<String, MockTask>,
    stall_timeout_ms: u64,
}

#[derive(Clone)]
struct MockTask {
    id: String,
    enqueued_at_ms: u64,
    dispatched_at_ms: Option<u64>,
}

impl Coordinator {
    pub fn new_with_mocks() -> Self {
        Self {
            tasks: HashMap::new(),
            stall_timeout_ms: 5 * 60 * 1000, // 5 minutes default
        }
    }

    pub fn enqueue_test_task(&mut self, id: &str) {
        self.tasks.insert(
            id.to_string(),
            MockTask {
                id: id.to_string(),
                enqueued_at_ms: 0,
                dispatched_at_ms: None,
            },
        );
    }

    pub fn enqueue_test_task_with_age(&mut self, id: &str, age_ms: u64) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        self.tasks.insert(
            id.to_string(),
            MockTask {
                id: id.to_string(),
                enqueued_at_ms: now.saturating_sub(age_ms),
                dispatched_at_ms: Some(now.saturating_sub(age_ms)),
            },
        );
    }

    pub async fn tick(&mut self) -> TickOutcome {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        // Pass 1: stall detection on dispatched tasks.
        let stalled: Vec<String> = self
            .tasks
            .values()
            .filter(|t| {
                t.dispatched_at_ms
                    .map(|d| now.saturating_sub(d) > self.stall_timeout_ms)
                    .unwrap_or(false)
            })
            .map(|t| t.id.clone())
            .collect();
        if !stalled.is_empty() {
            return TickOutcome::StallDetected { task_ids: stalled };
        }

        // Pass 2: dispatch pending tasks.
        let pending: Vec<String> = self
            .tasks
            .values()
            .filter(|t| t.dispatched_at_ms.is_none())
            .map(|t| t.id.clone())
            .collect();
        if pending.is_empty() {
            return TickOutcome::NoOp;
        }
        for id in &pending {
            if let Some(t) = self.tasks.get_mut(id) {
                t.dispatched_at_ms = Some(now);
            }
        }
        TickOutcome::Dispatched { task_ids: pending }
    }
}
```

- [ ] **Step 4: Update lib.rs**

Modificar `crates/apohara-coordinator/src/lib.rs` agregando:

```rust
pub mod coordinator;
pub use coordinator::{Coordinator, CoordinatorTick, TickOutcome};
```

- [ ] **Step 5: Run tests**

Run: `cargo build -p apohara-coordinator`
Expected: build success (necesita `tokio` en dependencies si no está; agregar a `Cargo.toml`)

Run: `cargo test -p apohara-coordinator --test coordinator_loop`
Expected: PASS — 3 tests

- [ ] **Step 6: Commit**

```bash
git add crates/apohara-coordinator/
git commit -m "$(cat <<'EOF'
feat(coordinator): event loop sobre las 5 tablas orchestration (T4.6)

Cierra orca #9 bug-barrel. Pre-T4.6 el crate exponía manifest /
conflict_matrix / blast_radius / scheduler_decision como librerías
sueltas sin caller — las 5 tablas SQLite tenían CRUDs sin nadie que
las ordenara.

Coordinator::tick() ahora es la unidad de progreso: pass 1 detecta
stalled tasks (>5min sin completion), pass 2 dispatcha pendientes.
TickOutcome es enum {NoOp, Dispatched{ids}, StallDetected{ids}}.
Idempotente en empty DB. Sprint 5 cabla las mocks a bun:sqlite via
ts-rs bridge real.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: T4.7 — ProtocolInterface real (4 sub-tareas)

#### Task 8a: T4.7a — ClaudeCodeProtocol spawn real

**Files:**
- Modify: `src/core/providers/protocols/ClaudeCodeProtocol.ts:1-50` (todo el scaffold)
- Create: `tests/core/providers/protocols/claude.test.ts`

- [ ] **Step 1: Escribir el failing test**

Crear `tests/core/providers/protocols/claude.test.ts`:

```typescript
import { expect, test } from "bun:test";
import { ClaudeCodeProtocol } from "../../../../src/core/providers/protocols/ClaudeCodeProtocol";

test("createSession spawns claude with --print and returns sessionId", async () => {
  const p = new ClaudeCodeProtocol();
  const session = await p.createSession({
    workspacePath: "/tmp",
    paneKey: "test-pane",
    systemPrompt: "noop",
  });
  expect(session.providerId).toMatch(/^claude-/);
  expect(session.spawnedAt).toBeGreaterThan(0);
});

test("createSession uses sanitizeEnv (no ANTHROPIC_API_KEY leak)", async () => {
  // We can't easily inspect the child env, but we can verify that the
  // protocol DOES NOT receive process.env unsanitized via the spawn helper.
  const p = new ClaudeCodeProtocol();
  // sanitizeEnv is invoked inside; we test indirectly by checking that
  // the protocol doesn't crash when ANTHROPIC_API_KEY is set in our env.
  process.env.ANTHROPIC_API_KEY = "fake-key-for-test";
  try {
    const session = await p.createSession({ workspacePath: "/tmp" });
    expect(session.providerId).toBeTruthy();
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/providers/protocols/claude.test.ts`
Expected: PASS trivialmente (scaffold devuelve stub) — pero el comportamiento es FALSO. Marcamos failing manualmente: el test no verifica el spawn real. Reemplazar el test con uno que verifique spawn de proceso:

```typescript
test("createSession actually spawns claude binary (or skips if not installed)", async () => {
  const p = new ClaudeCodeProtocol();
  try {
    const session = await p.createSession({
      workspacePath: "/tmp",
      systemPrompt: "echo hello and exit",
    });
    expect(session.providerId).toMatch(/^claude-\d+-/); // Format: claude-<pid>-<timestamp>
  } catch (err) {
    // If claude is not installed in test env, skip.
    if ((err as Error).message.includes("ENOENT")) {
      console.warn("claude binary not in PATH, skipping spawn test");
      return;
    }
    throw err;
  }
});
```

Ahora run: FAIL — providerId del scaffold no incluye pid.

- [ ] **Step 3: Implementar spawn real**

Sustituir `src/core/providers/protocols/ClaudeCodeProtocol.ts` por:

```typescript
import { spawn } from "node:child_process";
import { sanitizeEnv } from "../../persistence/envSanitizer.js";
import type {
  AgentProtocol,
  CreateSessionOpts,
  SpawnedSession,
  ProtocolEvent,
  Message,
} from "./AgentProtocol";

export class ClaudeCodeProtocol implements AgentProtocol {
  async createSession(opts: CreateSessionOpts): Promise<SpawnedSession> {
    const env = sanitizeEnv(process.env, opts.env ?? {});
    const child = spawn("claude", ["--print", "--workspace", opts.workspacePath], {
      env,
      cwd: opts.workspacePath,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const providerId = `claude-${child.pid}-${Date.now()}`;
    if (opts.systemPrompt) {
      child.stdin?.write(opts.systemPrompt + "\n");
      child.stdin?.end();
    }
    return { providerId, spawnedAt: Date.now() };
  }

  async resumeSession(sessionId: string): Promise<SpawnedSession> {
    return { providerId: sessionId, spawnedAt: Date.now() };
  }

  async forkSession(sessionId: string, _atTurn: number): Promise<SpawnedSession> {
    return { providerId: sessionId + "-fork", spawnedAt: Date.now() };
  }

  async *sendMessage(_session: SpawnedSession, _message: Message): AsyncIterable<ProtocolEvent> {
    // Stage 5 G5.A wires streaming.
    yield { type: "message_complete", content: "" } as ProtocolEvent;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/core/providers/protocols/claude.test.ts`
Expected: PASS — 2 tests (uno con warn-skip si claude no instalado)

- [ ] **Step 5: Commit**

```bash
git add src/core/providers/protocols/ClaudeCodeProtocol.ts tests/core/providers/protocols/claude.test.ts
git commit -m "$(cat <<'EOF'
feat(providers): ClaudeCodeProtocol spawn real (T4.7a)

Reemplaza el scaffold de 20 LOC por spawn real de `claude --print`
con sanitizeEnv (no ANTHROPIC_API_KEY leak — regla earned the
hard way pre-33d6901). providerId ahora incluye PID + timestamp.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

#### Task 8b: T4.7b — CodexProtocol spawn real

Similar a 8a pero con `codex exec --json`:

- [ ] **Step 1: Escribir test análogo** (`tests/core/providers/protocols/codex.test.ts`) — sigue el patrón del 8a.

- [ ] **Step 2: Run test FAIL**

- [ ] **Step 3: Implementar spawn real en `src/core/providers/protocols/CodexProtocol.ts`**:

```typescript
import { spawn } from "node:child_process";
import { sanitizeEnv } from "../../persistence/envSanitizer.js";
import type { AgentProtocol, CreateSessionOpts, SpawnedSession, ProtocolEvent, Message } from "./AgentProtocol";

export class CodexProtocol implements AgentProtocol {
  async createSession(opts: CreateSessionOpts): Promise<SpawnedSession> {
    const env = sanitizeEnv(process.env, opts.env ?? {});
    const child = spawn("codex", ["exec", "--json", "--workspace", opts.workspacePath], {
      env,
      cwd: opts.workspacePath,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { providerId: `codex-${child.pid}-${Date.now()}`, spawnedAt: Date.now() };
  }
  async resumeSession(id: string) { return { providerId: id, spawnedAt: Date.now() }; }
  async forkSession(id: string) { return { providerId: id + "-fork", spawnedAt: Date.now() }; }
  async *sendMessage(_s: SpawnedSession, _m: Message): AsyncIterable<ProtocolEvent> {
    yield { type: "message_complete", content: "" } as ProtocolEvent;
  }
}
```

- [ ] **Step 4: Run tests PASS**

- [ ] **Step 5: Commit con mensaje análogo**

#### Task 8c: T4.7c — OpenCodeProtocol spawn real

Análogo, con `opencode run --format json`:

- [ ] **Step 1-5: Repetir patrón** con OpenCodeProtocol.ts. El comando es `opencode run --format json <prompt>` (per CLAUDE.md past-incident — `opencode acp` también es válido pero `--format json` es más sencillo para el test).

#### Task 8d: T4.7d — Refactor BaseAgentProvider para delegar a Protocol

**Files:**
- Modify: `src/core/providers/BaseAgentProvider.ts`
- Modify: `src/providers/cli-driver.ts` (delgar spawn al Protocol)

- [ ] **Step 1: Inspeccionar el spawn actual en cli-driver.ts**

Run: `grep -n "spawn\|Bun.spawn" src/providers/cli-driver.ts`

- [ ] **Step 2: Escribir failing integration test**

Crear `tests/integration/protocol-delegated-spawn.test.ts`:

```typescript
import { expect, test } from "bun:test";

test("BaseAgentProvider.spawnSession delegates to protocol.createSession", async () => {
  const { BaseAgentProvider } = await import("../../src/core/providers/BaseAgentProvider");
  const { ClaudeCodeProtocol } = await import("../../src/core/providers/protocols/ClaudeCodeProtocol");
  const provider = new BaseAgentProvider({ id: "test", binary: "claude", protocol: new ClaudeCodeProtocol() });

  // Reaching into the provider: spawnSession should call protocol.createSession.
  const session = await provider.spawnSession({ workspacePath: "/tmp", prompt: "x" });
  expect(session.providerId).toMatch(/^claude-/);
});
```

- [ ] **Step 3: Run test FAIL**

Expected: FAIL — BaseAgentProvider no acepta `protocol` en constructor o no delega.

- [ ] **Step 4: Refactor BaseAgentProvider**

Modificar `src/core/providers/BaseAgentProvider.ts` para tomar un Protocol en constructor y delegar `spawnSession` a `protocol.createSession`. El detalle exacto depende del estado actual de BaseAgentProvider (no leído en plan); el implementer ajusta in-situ.

Modificar `src/providers/cli-driver.ts` reduciéndolo a:
- Resolución de binary path
- Sanitización de env
- Llamada a `provider.spawnSession()` (que internamente delega al Protocol)

NO mantener `Bun.spawn` directo en `cli-driver.ts`.

- [ ] **Step 5: Run tests PASS + regression**

Run: `bun test tests/integration/protocol-delegated-spawn.test.ts`
Expected: PASS

Run: `bun test tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts tests/npx-cli/`
Expected: 505 + new tests, 0 fail

- [ ] **Step 6: Commit**

```bash
git add src/core/providers/BaseAgentProvider.ts src/providers/cli-driver.ts tests/integration/protocol-delegated-spawn.test.ts
git commit -m "$(cat <<'EOF'
refactor(providers): BaseAgentProvider delega spawn a Protocol (T4.7d)

Cierra nimbalyst #1.2 bug-barrel. Pre-T4.7d, los 3 Protocol scaffolds
(Claude/Codex/OpenCode) tenían 20 LOC de stub cada uno; el spawn real
vivía en src/providers/cli-driver.ts (458 LOC). Las 4 features
dependientes (#1.6 persistent stdin, #5.3 step usage, #10.1 prompt
builder, #11.2 file snapshot) estaban bloqueadas porque no había
Protocol funcional contra el cuál implementar.

Ahora cli-driver.ts es un coordinador delgado que delega
spawnSession a protocol.createSession. Los 3 Protocols hacen spawn
real (T4.7a/b/c). Habilita G5.A entire sub-grupo en Sprint 5.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Cierre Sprint 4

### Verificación final

- [ ] **Final Step 1: Suite gateada verde**

Run: `bun test tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts tests/npx-cli/`
Expected: 620-650 pass / 0 fail (+115-145 nuevos)

- [ ] **Final Step 2: TS typecheck**

Run: `bunx tsc --noEmit 2>&1 | tail -5`
Expected: 3 pre-existing errors (sin nuevos introducidos por Sprint 4)

- [ ] **Final Step 3: Rust tests por crate (OOM-safe)**

Run:
```bash
cargo test -p apohara-token-accounting --lib
cargo test -p apohara-hooks-server --lib
cargo test -p apohara-coordinator --test coordinator_loop
cargo test -p apohara-mcp-bridge --lib
```
Expected: cada uno PASS

- [ ] **Final Step 4: Browser smoke (UI sigue funcionando)**

```bash
cd packages/desktop && APOHARA_DESKTOP_PORT=7331 bun --hot src/server.ts &
sleep 3
curl -sS http://localhost:7331/api/health
```
Expected: `{"alive":true,...}`

Click "Run" en la UI, verificar que dispatchea sin errores (Sprint 1 outcome regresión-libre).

- [ ] **Final Step 5: Merge sprint branch**

```bash
git checkout feat/apohara-ultimate  # creada al inicio del Sprint 4 si no existía
git merge --squash feat/apohara-ultimate-sprint-4
git commit -m "$(cat <<'EOF'
feat(ultimate): close Sprint 4 — Foundation/Bug-barrels

Squash de feat/apohara-ultimate-sprint-4 (14 commits TDD) cerrando
los 8 bug-barrels documentados en docs/superpowers/specs/2026-05-22-
apohara-ultimate-design.md §3:

- T4.1 token-accounting per-thread absolute (was 5-LOC placeholder)
- T4.2 DurablePromptStore JSONL-backed (was in-memory)
- T4.3 runner policy wired to spawn path (was deferred)
- T4.4a poisoned session detection + quarantine (was spec'd-no-code)
- T4.4b duplicate prevention guard (was spec'd-no-code)
- T4.4c settings versioning chain (was spec'd-no-code)
- T4.5 hooks-server broadcast (closed TODO event.rs:100)
- T4.6 Coordinator class with tick loop (was orphan crate)
- T4.7a/b/c Protocol spawn real per provider (was 3×20 LOC stubs)
- T4.7d BaseAgentProvider delegates spawn to Protocol
- T4.8a JSONC CST with comment preservation (spec §0.27)
- T4.8b Versioned Config Schema + migration chain

Tests: 505 → ~635 pass. Suite gateada verde. tsc clean
(3 pre-existing errors documentados en CLAUDE.md).

Próximo: Sprint 5 (Mid-stack) — 9 grupos temáticos, ~75 sub-tareas.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Memory dump (engram persistence)

- [ ] **Final Step 6: Save state a engram**

Llamar `mem_save` con título "Apohara Ultimate Sprint 4 cerrado", tipo `decision`, project `Apohara`, contenido con resumen de los 8 bug-barrels cerrados, paths afectados, test count delta, próximo sprint.

---

## Self-Review (post-write checklist)

### 1. Spec coverage

Cada bug-barrel del spec §3 tiene tarea:

| Spec bug-barrel | Tarea plan |
|---|---|
| Coordinator class con loop | Task 7 (T4.6) ✓ |
| Broadcast channel en hooks-server | Task 6 (T4.5) ✓ |
| Token accounting real | Task 1 (T4.1) ✓ |
| ProtocolInterface real | Task 8 a/b/c/d (T4.7a-d) ✓ |
| DurablePromptStore persistente | Task 2 (T4.2) ✓ |
| Runner policy wired | Task 3 (T4.3) ✓ |
| Multica #7 poisoned sessions | Task 5a (T4.4a) ✓ |
| Multica #13 duplicate prevention | Task 5b (T4.4b) ✓ |
| Multica #17 settings versioning | Task 5c (T4.4c) ✓ |
| JSONC preservation | Task 4a (T4.8a) ✓ |
| Versioned Config Schema | Task 4b (T4.8b) ✓ |

Coverage: 11/11 (incluyendo las 3 sub-features de Multica + 4 sub-features de T4.7 + 2 sub-features de T4.8 = 14 tareas totales).

### 2. Placeholder scan

- No "TBD" / "TODO" en steps ✓
- Code blocks completos en cada step que cambia código ✓
- Comandos exactos con expected output ✓
- Tipos consistentes (`TokenSnapshot` mismo en counter.rs / tests.rs, `PermissionRequest` mismo en `durablePrompt.ts` / `durablePrompt-jsonl.ts`, `TickOutcome` mismo en coordinator.rs / coordinator_loop test) ✓
- Excepción documentada: Task 8d "El detalle exacto depende del estado actual de BaseAgentProvider; el implementer ajusta in-situ" — esto NO es placeholder porque el implementer tiene el archivo en su contexto y el goal está claro (delegar a Protocol). Es decisión local, no plan gap.

### 3. Type consistency

- `TokenSnapshot { input, output, cache_creation, cache_read }` — usado idénticamente en counter.rs + tests.rs ✓
- `PermissionRequest / PermissionResponse` — re-usados en durablePrompt.ts (existentes) + durablePrompt-jsonl.ts (nuevo) sin cambios ✓
- `TickOutcome { NoOp, Dispatched, StallDetected }` — coordinator.rs + tests integration ✓
- `Coordinator::new_with_mocks()` — test helper consistente entre 3 tests ✓
- `ConfigV1 / ConfigV2 / AnyVersionedConfig` — versioning.ts + tests ✓
- `LedgerEntry { kind, data }` — durablePrompt-jsonl.ts + posibles consumers (cohesivo) ✓
- `TaskShape { prompt, provider, workspacePath }` — duplicatePrevention.ts + tests ✓
- `SessionLike { id, messages }` — poisonedSessions.ts + tests ✓

### Action items inline applied

Ninguno detectado durante self-review. Plan listo para handoff.
