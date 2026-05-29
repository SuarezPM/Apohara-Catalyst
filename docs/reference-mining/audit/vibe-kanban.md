> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

# Audit: vibe-kanban (20 hallazgos)

> Audit ejecutado 2026-05-22 sobre `feat/apohara-v1` HEAD (`d9372eb feat(npx): npx-installable apohara binary launcher (T3.5)`).
> Cross-check de cada hallazgo del archivo `docs/reference-mining/vibe-kanban.md` contra el estado real del código en `crates/`, `src/`, `packages/`, `npx-cli/`.

## Resumen

| Status | Cantidad |
|---|---:|
| ✅ COMPLETO | 4 |
| 🟡 PARCIAL | 9 |
| ❌ NO IMPLEMENTADO | 5 |
| 🚫 RECHAZADO | 0 |
| ❓ AMBIGUO | 2 |
| **Total** | **20** |

## Hallazgos

### Hallazgo 1: MCP Config Adapter Pattern (canonical → 6 dialectos)
- **Origen vibe-kanban**: `crates/executors/src/mcp_config.rs`, `dev_assets_seed/.../default_mcp.json`.
- **Apohara actual**: `crates/apohara-mcp-bridge/` (canonical + adapters/{claude,codex,opencode}), `src/core/mcp/mcpInjection.ts`.
- **Status**: ✅ COMPLETO (para los 3 providers activos).
- **Evidencia**: `crates/apohara-mcp-bridge/src/canonical.rs` define `McpCanonical/McpServerCanonical` con `meta`/`env`/`type`. `src/adapters/{claude.rs,codex.rs,opencode.rs}` + `default_mcp.json` + tests en `tests/adapters.rs`. Commit `a8b21d4 feat(mcp-bridge): canonical → 3 dialects (claude/codex/opencode)`. Spec §8.7 + Plan Task 8.7.
- **Recomendación**: ninguna (alineado al roster restringido de 3 CLIs activos).

### Hallazgo 2: JSONC con preservación de comentarios via CST
- **Origen vibe-kanban**: `crates/executors/src/mcp_config.rs:106-190` (`write_jsonc_preserving_comments` + `deep_merge_cst_object`).
- **Apohara actual**: `src/core/mcp/mcpInjection.ts:115-141` para opencode, `crates/apohara-mcp-bridge/src/adapters/codex.rs` para TOML.
- **Status**: ❌ NO IMPLEMENTADO.
- **Evidencia**: `grep -r "jsonc-parser" Cargo.toml crates/*/Cargo.toml` → 0 hits. La inyección de opencode hace `JSON.stringify({ mcp }, null, 2)` (overwrite total que destruye comentarios y formatting). Spec §0.27 lo declara obligatorio pero ningún task del Plan lo cumple aún. La línea explícita del Plan (line 10450) cita `jsonc-parser` pero la implementación de Stage 8 sólo serializa con JSON.
- **Gap**: 100% del feature. Configs del usuario con comentarios serán destruidos en el primer escribir.
- **Recomendación**: añadir crate `jsonc-parser = "0.29"` a `apohara-mcp-bridge` y replantear la inyección como read→merge CST→write (no full overwrite).

### Hallazgo 3: JSON-Patch streaming over WebSocket
- **Origen vibe-kanban**: `crates/services/src/services/events/patches.rs`, `streams.rs`.
- **Apohara actual**: ninguno; transport es SSE ad-hoc.
- **Status**: ❌ NO IMPLEMENTADO.
- **Evidencia**: `grep -r "json-patch\|RFC 6902\|jsonpatch\|fast-json-patch"` → 0 hits en `crates/` y `src/`. Spec §8.0 lo menciona como parte del SSE design pero no hay crate `json-patch` ni `applyPatch` client-side.
- **Gap**: Apohara emite eventos ad-hoc por SSE sin contrato de patches; no hay snapshot+Ready+live, no hay filtering server-side por session.
- **Recomendación**: post-v1.0 si hay quejas de latencia/state-sync; adoptar `json-patch = "2.0"` + `fast-json-patch` en frontend cuando el coordinator gane sub-segundos de UI events.

### Hallazgo 4: `ts-rs` para Single Source of Truth Rust↔TS
- **Origen vibe-kanban**: `Cargo.toml:50`, `crates/server/src/bin/generate_types.rs`.
- **Apohara actual**: `crates/apohara-types/src/bin/generate_types.rs` (141 líneas, agregador real), `package.json` scripts `generate-types` y `generate-types:check`.
- **Status**: ✅ COMPLETO.
- **Evidencia**: 8 types con `#[derive(TS)]` exportan a `crates/*/bindings/*.ts` y se agregan determinísticamente en `packages/apohara-shared/types.ts`. Commit `dfad239 fix(types): real ts-rs aggregator — §0.7 SSoT no longer stubbed` resolvió el stub previo. CLAUDE.md (§"Past incidents") cita el incidente y la regla. Plan §0.7 + spec.
- **Recomendación**: ninguna.

### Hallazgo 5: NPX-CLI distribution (binary downloader + Tauri fallback)
- **Origen vibe-kanban**: `npx-cli/src/cli.ts:30-279`, `download.ts:155-275`.
- **Apohara actual**: `npx-cli/{cli.ts,download.ts,platform.ts,cache.ts}`.
- **Status**: 🟡 PARCIAL.
- **Evidencia**: `npx-cli/src/cli.ts` resuelve binario por versión, cachea en `~/.apohara/bin/<v>/...`, descarga desde GitHub Releases (no R2) con sha256 sidecar verificado (`download.ts:79-83`). Commit `d9372eb feat(npx): npx-installable apohara binary launcher (T3.5)`.
- **Gap**: no soporta `--desktop` (bundle Tauri) ni `--mcp` mode. No detecta arch macOS Rosetta. Distribuye un solo binario (`apohara-desktop`) en lugar del set `{server,mcp,sandbox,indexer}`. No tiene `.installed` sentinel ni manifest separado para versiones. No usa `adm-zip` (los assets son binarios "naked" sin descompresión).
- **Recomendación**: si Apohara escala a bundles (Tauri MSI/dmg), añadir flag `--desktop` con manifest separado siguiendo el patrón `ensureDesktopBundle` de vibe.

### Hallazgo 6: MCP Server propio en dos modos (Global vs Orchestrator)
- **Origen vibe-kanban**: `crates/mcp/src/bin/vibe_kanban_mcp.rs:100-134`, `handler.rs:11-44`.
- **Apohara actual**: `src/core/mcp/servers/{apohara-ledger,apohara-runs,apohara-indexer,apohara-settings,apohara-commit}.ts` + `bootstrap.ts`.
- **Status**: 🟡 PARCIAL.
- **Evidencia**: hay 5 servidores MCP internos (Stage 8). `bootstrap.ts` arranca los 4 principales con bearer token y endpoint file (`~/.apohara/sockets/mcp-endpoints.json`). Pero `src/cli.ts` no expone `apohara mcp serve` ni `--mode global|orchestration`. No hay binary externo `apohara-mcp` ni dual-mode discovery via `~/.apohara/port`.
- **Gap**: agentes en plena orquestación no pueden auto-llamarse al coordinator por MCP scoped al workspace activo (no existe `get_orchestration_context`, `submit_verdict`, etc.).
- **Recomendación**: añadir comando `apohara mcp serve [--mode orchestration]` que reuse los servers de `src/core/mcp/servers/` con un transport stdio externo y port-file discovery (futuro Stage post-v1.0).

### Hallazgo 7: Worktree Manager con lock global + retry + cleanup comprehensivo
- **Origen vibe-kanban**: `crates/worktree-manager/src/worktree_manager.rs:54-580` (`LazyLock<Mutex<HashMap>>`, retry, 4-step cleanup).
- **Apohara actual**: `crates/apohara-worktree/src/{lifecycle.rs,cleanup.rs,preflight.rs,naming.rs,lineage.rs,uds.rs}` (623 LOC totales).
- **Status**: 🟡 PARCIAL.
- **Evidencia**: lifecycle.rs ofrece create/list/cleanup con metadata + lockfile (`.apohara-lock` con PID). cleanup.rs implementa `adopt_orphan` (5-min stale lock) y `prune_stale`. preflight.rs valida el repo antes. Pero NO hay `LazyLock<Mutex<HashMap<path, Arc<tokio::sync::Mutex>>>>` para serializar operaciones concurrentes en la misma path. NO hay retry. NO hay 4-step comprehensive cleanup (metadata force-cleanup → physical removal → `git worktree prune` → libgit2 verify). NO hay manejo explícito de `/private/` alias macOS, ni regression test "repo dentro de worktree".
- **Gap**: locking es file-based con mtime — race conditions entre dos invocaciones del mismo proceso siguen siendo posibles. Sin `git worktree prune` integration.
- **Recomendación**: añadir in-process `LazyLock<Mutex<HashMap>>` per-path y un step explícito `git -C repo worktree prune` post-cleanup. Test de regresión para repo-dentro-de-worktree.

### Hallazgo 8: Approvals/Questions Service con timeout + waiters compartidos
- **Origen vibe-kanban**: `crates/services/src/services/approvals.rs:30-200`, `crates/executors/src/approvals.rs:29-91`.
- **Apohara actual**: `src/core/safety/{permissionService.ts,durablePrompt.ts,permissionCache.ts}` + `packages/desktop/src/store/permissionStore.ts`.
- **Status**: 🟡 PARCIAL.
- **Evidencia**: `permissionService.check()` implementa deny→cache→allow→ask (spec §4.6). `DurablePromptStore` enqueueRequest/setResponse/waitForResponse con 10-min timeout. Compound-bash forzado a scope=`once`. Pero la implementación es **polling-based** (`setTimeout(r, pollMs=100)` en loop) en lugar del patrón `broadcast::Sender<Patch>` + `oneshot::Sender<ApprovalOutcome>` + `Shared<BoxFuture>`. No hay trait `ExecutorApprovalService` con `NoopApprovalService` para tests. No hay emission de patches a `/permissions/{id}`.
- **Gap**: latencia de polling (100ms) en lugar de wake-on-event; múltiples consumers no comparten un solo waiter (cada uno polls independiente).
- **Recomendación**: cuando se migre realtime a JSON-Patch (Hallazgo 3), reemplazar el polling por broadcast + shared-future. Por ahora suficiente para v1.0.

### Hallazgo 9: Preview-proxy (iframe subdomain routing + asset injection + Next.js RSC)
- **Origen vibe-kanban**: `crates/preview-proxy/src/lib.rs:1-1275`.
- **Apohara actual**: ninguno.
- **Status**: ❌ NO IMPLEMENTADO.
- **Evidencia**: `grep -r "iframe\|inject.*script\|NEXT_REDIRECT" --include="*.rs" --include="*.ts"` → 0 hits.
- **Recomendación**: explícitamente NO-GOAL para v1.0 (Apohara no embebe preview de apps de usuario). Mantener fuera de scope. Si futuro feature "ver UI rendered por el agente" entra al roadmap, este es el blueprint.

### Hallazgo 10: Versioned Config Schema (v1→v8 migration chain)
- **Origen vibe-kanban**: `crates/services/src/services/config/versions/v1.rs..v8.rs`.
- **Apohara actual**: ninguno; el config no está versionado.
- **Status**: ❌ NO IMPLEMENTADO.
- **Evidencia**: el crate `apohara-config` no existe (`ls crates/ | grep -i config` → 0). No hay módulo `versions/` ni `From<String> for Config`. Spec §0.1 lo prescribe (`crates/apohara-config/src/versions/{v1,v2,...}.rs`) pero no hay task asignado en el Plan.
- **Gap**: el primer `apohara` release no podrá migrar configs viejas a v2.
- **Recomendación**: crear `crates/apohara-config` con `versions/v1.rs` antes de Stage 11 release; añadir struct + `#[serde(default)]` + alias.

### Hallazgo 11: AGENTS.md scoped + symlink CLAUDE.md→AGENTS.md
- **Origen vibe-kanban**: AGENTS.md root + per-crate (`crates/remote/AGENTS.md`, `docs/AGENTS.md`, `packages/local-web/AGENTS.md`), symlink `CLAUDE.md → AGENTS.md`.
- **Apohara actual**: AGENTS.md root + 7 per-crate, symlink `CLAUDE.md -> AGENTS.md` confirmado.
- **Status**: 🟡 PARCIAL.
- **Evidencia**: `find . -name "AGENTS.md"` → 8 archivos (root + crates/{secrets,pathsafety,persistence,audit,notifications,attention,hooks-server}). `ls -la CLAUDE.md` → symlink hacia `AGENTS.md`. La línea "do not edit shared/types.ts" sí está presente en CLAUDE.md.
- **Gap**: faltan AGENTS.md en 9 de 16 crates (`apohara-types`, `apohara-indexer`, `apohara-sandbox`, `apohara-worktree`, `apohara-coordinator`, `apohara-token-accounting`, `apohara-mcp-bridge`, `apohara-event-humanizer`, `apohara-anti-thrash`). Tampoco hay AGENTS.md en `packages/{desktop,tui,github-bridge,apohara-shared}` ni en `src/core/`.
- **Recomendación**: completar AGENTS.md para los 9 crates restantes y los 4 packages TS (baja inversión, alto valor para context-priming).

### Hallazgo 12: Cross-platform Push Notifications con global injection
- **Origen vibe-kanban**: `crates/services/src/services/notification.rs:13-297`, assets/sounds/, assets/scripts/toast-notification.ps1.
- **Apohara actual**: `crates/apohara-notifications/src/lib.rs` (157 líneas).
- **Status**: 🟡 PARCIAL.
- **Evidencia**: trait `Notifier` + `OnceLock<Arc<dyn Notifier>>` global ✅, `DefaultNotifier` para macOS (osascript con `applescript_escape` anti-injection) y Linux (`notify-rust`) ✅. Pero Windows es un stub que sólo loggea (líneas 119-132). NO hay PowerShell toast script. NO hay WSL2→Windows path conversion cacheada. NO hay sound playback (`afplay`/`paplay`/`aplay`/PowerShell SoundPlayer).
- **Gap**: Windows + WSL2 + sound notifications faltan. Para Pablo (CachyOS) Linux está cubierto, pero distribuir a Windows usuarios requiere el toast PS1.
- **Recomendación**: completar el target Windows con PowerShell toast antes de cualquier release Windows; añadir WSL2 path-conversion cache.

### Hallazgo 13: Embedded SSH Server + Editor URL builder
- **Origen vibe-kanban**: `crates/embedded-ssh/`, `crates/desktop-bridge/src/service.rs:22-62`.
- **Apohara actual**: ninguno (sólo SSH-URL *parsing* en `src/lib/git.ts:38`).
- **Status**: ❌ NO IMPLEMENTADO.
- **Evidencia**: `find . -name "*ssh*"` sólo devuelve git.ts y sus tests; `grep -r "vscode://\|ssh-remote+"` → 0 hits.
- **Nota explícita**: Pablo promovió este item a Apohara Ultimate (no debe marcarse como rechazado). Sigue siendo NO IMPLEMENTADO en `feat/apohara-v1` y debe quedar para Apohara v2.0 / Ultimate.
- **Recomendación**: planificar crate `apohara-ssh-bridge` para Ultimate. Como quick-win pre-v1.0 se puede adoptar sólo el "editor URL builder" (open-in-editor button) sin servidor SSH; el costo es trivial y aporta UX.

### Hallazgo 14: Dev environment setup script (auto ports + seed assets)
- **Origen vibe-kanban**: `scripts/setup-dev-environment.js:14-262`, `dev_assets_seed/{config.json,db.sqlite}`.
- **Apohara actual**: `scripts/demo-dashboard.sh`, `scripts/install.sh`, `scripts/postinstall.js`, `scripts/scaffold-crate.sh`.
- **Status**: ❌ NO IMPLEMENTADO.
- **Evidencia**: `grep -rln "setup-dev\|.dev-ports.json\|dev_assets_seed"` → 0 hits. `demo-dashboard.sh` orquesta el demo pero no aloca puertos ni seedea DB.
- **Recomendación**: crear `scripts/setup-dev-environment.ts` (bun) que aloca puertos libres para coordinator/hooks-server/indexer/desktop dev y seedea `dev_assets_seed/orchestration.db` con `onboarding_acknowledged: true`. Quick DX win.

### Hallazgo 15: `enum_dispatch` para `CodingAgent` polymorphism sin Box<dyn>
- **Origen vibe-kanban**: `crates/executors/src/executors/mod.rs:94-202`, `Cargo.toml` con `enum_dispatch = "0.3.13"`, `strum = "0.27"`.
- **Apohara actual**: `src/core/providers/BaseAgentProvider.ts` (TS abstract class + 2 subclasses + LegacyProvider).
- **Status**: ❓ AMBIGUO.
- **Evidencia**: no hay crate `apohara-providers` en Rust — los providers viven en TS como `class ClaudeCodeProvider extends BaseAgentProvider`. Spec §0.16 sí prescribe `enum_dispatch` ("§0.16 enum_dispatch instead of `Box<dyn>` for providers") pero el módulo TS no es candidato a este pattern (TS no tiene la dicotomía dyn-vs-static); el pattern aplicaría si Apohara migrara providers a Rust.
- **Gap**: para la arquitectura TS actual el pattern es irrelevante; para la spec (que asume providers Rust) está sin implementar.
- **Recomendación**: clarificar en el spec si providers son TS o Rust en v1.0. Si quedan en TS, eliminar §0.16 como aplicable; si se migran, adoptar `enum_dispatch` + `strum`.

### Hallazgo 16: Capabilities-based feature flags por agente
- **Origen vibe-kanban**: `crates/executors/src/executors/mod.rs:55-65, 177-201` (`BaseAgentCapability`).
- **Apohara actual**: `crates/apohara-types/src/capabilities.rs`.
- **Status**: 🟡 PARCIAL.
- **Evidencia**: enum `Capability` con 19 variants Rust definido (`SessionFork, ContextUsage, NativeMcpTools, BashTool, AgentHooks, RosterHardening, DriftDetection, SandboxAware, ...`) con `#[ts(export)]` ✅. Pero `grep -rn "Capability\|capabilities" src/core/providers/` → 0 hits: los providers TS no declaran su set de capabilities ni el UI las consulta.
- **Gap**: el enum está definido pero nunca leído. No hay `provider.capabilities()` ni `useCapability(provider, Capability.X)` hook en `packages/desktop/`.
- **Recomendación**: añadir `capabilities: readonly Capability[]` a `BaseAgentProvider`, declararlo en cada subclass, y exponer un `useCapability` hook en `packages/desktop/src/hooks/`. Sin esto el enum es código muerto.

### Hallazgo 17: Sound alerts con files empotrados
- **Origen vibe-kanban**: `/assets/sounds/` (8 wavs + rust-embed), settings sound_file selector.
- **Apohara actual**: ninguno.
- **Status**: ❌ NO IMPLEMENTADO.
- **Evidencia**: `find . -name "*.wav" -o -name "*.mp3"` → 0 hits fuera de target. `grep -rn "rust-embed\|sound_file"` → 0 hits. `Notification.sound` está en el struct (`crates/apohara-notifications/src/lib.rs:35`) pero ningún backend la usa.
- **Recomendación**: opcional (delight, no funcional). Posponer post-v1.0 a menos que Smart Attention HOT requiera audio cue.

### Hallazgo 18: Per-executor `default_profiles.json` con permission overrides + JSON Schemas
- **Origen vibe-kanban**: `crates/executors/src/default_profiles.json:1-67`, `shared/schemas/*.json`.
- **Apohara actual**: `src/core/providers/trust-presets.ts` + `src/core/providers/agent-config.ts`.
- **Status**: 🟡 PARCIAL.
- **Evidencia**: `trust-presets.ts` cubre claude/codex/cursor/copilot/aider (195 LOC) y pre-escribe la "trusted folder" en formato nativo de cada CLI. Pero NO hay un `default_profiles.json` declarativo con permission overrides (`dangerously_skip_permissions`, `sandbox: "danger-full-access"`, `yolo`, `allow_all_tools`, etc.) — los flags se pasan ad-hoc. NO hay JSON Schemas (`shared/schemas/{claude_code,codex,...}.json`) que validen configs ni sirvan para form-gen en UI.
- **Gap**: el "pure mode" requirement no está formalizado como mapping declarativo; sin schemas, los configs no se validan en UI.
- **Recomendación**: extraer un `crates/apohara-providers/default_pure_profiles.json` por provider y crear `shared/schemas/*.json` (draft-07) para validation + form generation desktop.

### Hallazgo 19: Crate-granularity workspace (38+ crates single-responsibility)
- **Origen vibe-kanban**: 38 workspace members en `Cargo.toml:1-35`.
- **Apohara actual**: 16 crates en `Cargo.toml` (`apohara-types, -indexer, -sandbox, -worktree, -pathsafety, -persistence, -notifications, -attention, -audit, -secrets, -token-accounting, -event-humanizer, -anti-thrash, -mcp-bridge, -hooks-server, -coordinator` + `packages/desktop/src-tauri`).
- **Status**: ✅ COMPLETO.
- **Evidencia**: `cat Cargo.toml | grep members | wc -l` confirma 16 workspace members con `workspace.dependencies` centralizada y un único `workspace.package` (`edition = "2021"`, `version = "1.0.0-dev"`). El número (16) es menor que vibe (38) pero el patrón (single-responsibility + shared deps) sí está adoptado.
- **Recomendación**: ninguna. La granularidad refleja el scope v1.0 — no inventar crates por inventar.

### Hallazgo 20: `spawn_blocking` para libgit2 + tree-sitter
- **Origen vibe-kanban**: `crates/worktree-manager/src/worktree_manager.rs` (todo libgit2 via spawn_blocking).
- **Apohara actual**: ninguno; git operations usan `tokio::process::Command` (async nativo) en lugar de libgit2.
- **Status**: ❓ AMBIGUO.
- **Evidencia**: `grep -rn "spawn_blocking" --include="*.rs"` → 0 hits. `grep -rn "git2\|libgit2"` → 0 hits. `crates/apohara-worktree/src/lifecycle.rs` usa `tokio::process::Command::new("git")` que ya es async. Spec §0.12 (`spawn_blocking para libgit2 + tree-sitter`) sigue aplicando para tree-sitter (`apohara-indexer`).
- **Gap**: si `apohara-indexer` hace parses largos de tree-sitter sin `spawn_blocking`, bloqueará el reactor. Verificar.
- **Recomendación**: auditar `crates/apohara-indexer/src/` por calls síncronas a `tree_sitter::*` y envolverlas en `tokio::task::spawn_blocking`. La aplicación a libgit2 es N/A (Apohara usó `tokio::process::Command` desde el inicio).

---

## Notas finales

- **Items vibe-kanban promovidos a Ultimate** (NO RECHAZADO): Hallazgo 13 (Embedded SSH) — quedará como deferred para v2.0.
- **Items explícitamente fuera de scope v1.0**: Hallazgo 9 (Preview-proxy) es no-goal para Apohara (no embebe UI de apps de usuario).
- **El audit no modificó código** salvo este archivo nuevo en `docs/reference-mining/audit/vibe-kanban.md`.
