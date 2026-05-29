> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

I now have enough material for a complete and rich report. Let me finalize my findings.

---

# Vibe Kanban — Hallazgos NUEVOS para Apohara v1.0

Análisis exhaustivo de `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/vibe-kanban/`. Apohara ya cubre el kanban + smart attention + coordinator + ledger + provider wrappers; los hallazgos abajo son **complementarios** y **diferenciadores** respecto a orca/nimbalyst.

Stack vibe-kanban: ~40 crates Rust (Cargo workspace, edition 2024) + pnpm workspace TS/React (local-web, remote-web, web-core, ui) + npx-cli TypeScript wrapper que descarga binarios desde R2. Backend Axum 0.8 + Tokio + SQLx 0.8 sqlite + ts-rs para sharing de tipos + rmcp para server MCP + `agent-client-protocol` + `codex-protocol`. SQLx con `sqlite-preupdate-hook` feature → emisión de JSON-Patch en cada cambio. Cero menciones a BERT/tree-sitter ni a un sidecar indexer — apohara-indexer sigue siendo único.

---

## 1. **MCP Config Adapter Pattern** — La joya de la corona

**Qué:** un canonical `default_mcp.json` (key, meta info, command/args) que se traduce a 6 dialectos distintos (passthrough / gemini / cursor / codex / opencode / copilot) usando funciones `adapt_*()` puras.
**Dónde:** `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/vibe-kanban/crates/executors/src/mcp_config.rs` (414 líneas, todo serde_json::Map transforms) + `/crates/executors/src/executors/mod.rs:127-171` (`CodingAgent::get_mcp_config` que devuelve `McpConfig { servers_path: Vec<String>, template, preconfigured, is_toml_config }`) + `/dev_assets_seed/.../default_mcp.json` con block `meta` para name/description/icon/url.
**Por qué inspira:** Apohara tiene "MCP config centralization" en spec pero sin diseño concreto. Cada provider tiene su propia path (`mcp_servers`, `mcpServers`, `amp.mcpServers`, `mcp`) y dialecto (HTTP→httpUrl en gemini, `tools: ["*"]` en copilot, type=remote/local en opencode, stdio-only en codex). Vibe lo resuelve elegantemente con un canonical + adapter por agente.
**Cómo traducir:** Crear `crates/apohara-mcp-bridge` con:
- `canonical_mcp.json` (commit'eado) que lista servers comunes (apohara-indexer, apohara-sandbox, git, github, playwright).
- `adapter.rs` con `fn adapt(agent: ProviderKind, canonical: Value) -> Value` por cada CLI provider wrapper (claude/codex/opencode/...).
- `McpConfig::new(servers_path, template, preconfigured, is_toml_config)` para escribir al config nativo de cada CLI.
- `meta` block con `name/description/icon/url` para UI catalog.
**Valor:** ALTO. Resuelve el problema "un solo dashboard de MCP que se sincroniza con N agents heterogéneos" sin hardcodear. Diferencia clara vs orca (que solo gestiona Claude Code) y nimbalyst.

---

## 2. **JSONC con preservación de comentarios** vía `jsonc-parser` CST

**Qué:** `update_jsonc_content()` parsea el archivo `.jsonc` del usuario a un CST, hace `deep_merge_cst_object()` recursivo y serializa back **conservando comentarios y formatting**. Soporta también TOML (codex) y JSON puro.
**Dónde:** `/crates/executors/src/mcp_config.rs:106-190` (write_jsonc_preserving_comments + deep_merge_cst_object + serde_json_to_cst_input).
**Por qué inspira:** Cualquier modificación a configs de usuario que tengan comentarios (vscode settings, claude config, etc.) los destruiría sin esto. Apohara va a tocar configs ajenas.
**Cómo traducir:** Usar crate `jsonc-parser = "0.29"` (features `cst, serde`) en cualquier escritor de configs (`apohara-coordinator`, `apohara-cli`). Pattern: read→merge en CST→write.
**Valor:** ALTO – evita la rotura de configs del usuario que es uno de los killer-bugs de orquestadores.

---

## 3. **JSON-Patch streaming over WebSocket** como protocolo de updates UI↔backend

**Qué:** Backend emite RFC 6902 JSON Patches (Add/Replace/Remove con paths `/workspaces/{id}`, `/execution_processes/{id}`, `/scratch`, `/approvals/{id}`) via `broadcast::Sender<Patch>`. Frontend recibe snapshot inicial + ready signal + live patches. Filtering by session_id se hace en el server.
**Dónde:** `/crates/services/src/services/events/patches.rs` (helper modules `execution_process_patch`, `workspace_patch`, `scratch_patch`, `approvals_patch`), `/crates/services/src/services/events/streams.rs:14-145` (stream con `initial_msg + LogMsg::Ready + filtered_stream`), `/crates/services/src/services/approvals.rs:121-122` (`patches_tx.send(approvals_patch::created(&info))`).
**Por qué inspira:** Apohara hoy probablemente usa SSE/WS ad-hoc. JSON-Patch da delta diffs gratis, integra con React state como `applyPatch(state, patch)`, y soporta selective subscription (filter by session/workspace). El pattern "snapshot + Ready marker + live" es industria-grade.
**Cómo traducir:** Adoptar `json-patch = "2.0"` en `apohara-coordinator`. Definir paths como `/orchestrations/{id}`, `/dispatches/{id}`, `/verdicts/{id}`, `/ledger/{hash}`. Cliente TS: `fast-json-patch` para aplicar. Subscriptions filtran en server.
**Valor:** ALTO – baja latencia, optimistic UI fácil, debugging excelente (logs de patches son legibles).

---

## 4. **`ts-rs` para Single Source of Truth de tipos Rust↔TS**

**Qué:** `#[derive(TS)]` en structs Rust + binario `generate_types` que escupe `shared/types.ts`. CI verifica con `generate-types:check` que no haya drift. Soporta enums TS reales con `#[ts(use_ts_enum)]`.
**Dónde:** `/Cargo.toml:50` (`ts-rs = { git = "...xazukx/ts-rs", branch = "use-ts-enum" }`), `/AGENTS.md:19-26` ("Do not manually edit shared/types.ts"), `/package.json:35` (`generate-types: cargo run --bin generate_types`), `/crates/server/src/bin/generate_types.rs`.
**Por qué inspira:** Apohara tiene TS (bun) + Rust (crates). Hoy probablemente duplica types o serializa por JSON sin contract. Esto rompe en cada refactor.
**Cómo traducir:** Añadir `ts-rs` workspace dep + `crates/apohara-types/src/bin/generate_types.rs` que escriba `packages/apohara-shared/types.ts`. Hook pre-commit + CI check. Apunta tanto `apohara-coordinator` interno como `apohara-tauri-bridge` para frontend Tauri.
**Valor:** ALTO – elimina toda una clase de bugs de contracts.

---

## 5. **NPX-CLI Distribution Pattern (binary downloader + Tauri fallback)**

**Qué:** `npx vibe-kanban` ejecuta TS wrapper que: (1) detecta platform/arch (incluyendo Rosetta en macOS), (2) descarga el zip apropiado desde R2 (`{BINARY_TAG}/{platform}/{name}.zip`) con SHA-256 verification + manifest.json, (3) cachea en `~/.vibe-kanban/bin/{tag}/{platform}/`, (4) descomprime con `adm-zip`, (5) ejecuta binario. Modo `--desktop` baja un Tauri bundle desde un manifest separado y lo instala. Tiene `LOCAL_DEV_MODE` que usa `npx-cli/dist/` para development.
**Dónde:** `/npx-cli/src/cli.ts:30-279` (getEffectiveArch incl. Rosetta detection, extractAndRun, runMain con desktop fallback, runMcp), `/npx-cli/src/download.ts:155-275` (ensureBinary, ensureDesktopBundle con `.installed` sentinel file, checksum verification con `crypto.createHash('sha256')`, redirect handling), `/local-build.sh:60-78` (zip + mv → npx-cli/dist).
**Por qué inspira:** Apohara hoy distribuye via Tauri build pero no tiene un CLI universal. Para usuarios que solo quieren CLI/server sin app desktop, este patrón es perfecto. Además es la forma de tener un MCP server `npx apohara@latest --mcp` sin requerir instalación previa.
**Cómo traducir:** Crear `npx-cli/` con bun-compiled TS o esbuild, publicar como `apohara-cli` en npm. R2 bucket (o Cloudflare R2/Backblaze) sirve binarios `{server, mcp, sandbox, indexer}-{platform}.zip` con `manifest.json` por release. SHA-256 validation obligatorio. Sentinel `.installed` para idempotencia. `apohara --desktop` baja Tauri bundle, default es server-only browser mode.
**Valor:** ALTO – un solo comando para usuarios casuales, sin barrera de Rust toolchain.

---

## 6. **MCP Server propio en dos modos (Global vs Orchestrator)**

**Qué:** Vibe expone su propio MCP server (`vibe-kanban-mcp` binary, stdio transport) con dos modos: `--mode global` (todos los tools, descubre backend via port file `~/.vibe-kanban/port`) o `--mode orchestrator` (scoped a un workspace activo, con `get_context` tool extra). Usa `rmcp = "1.2.0"`. Las instrucciones del server cambian dinámicamente listando todos los tools disponibles.
**Dónde:** `/crates/mcp/src/bin/vibe_kanban_mcp.rs:100-134` (resolve_base_url buscando `VIBE_BACKEND_URL` → `MCP_HOST/PORT` env → port file fallback), `/crates/mcp/src/task_server/handler.rs:11-44` (instructions con lista dinámica de tools), `/crates/mcp/src/task_server/tools/` (organizations, repos, sessions, task_attempts, issue_assignees, issue_tags, issue_relationships, workspaces, remote_issues, remote_projects, context).
**Por qué inspira:** El dual-mode es elegante: el mismo binario sirve para "external client conecta a apohara" como para "agent dentro de orquestación llama de vuelta al coordinator con scope al workspace actual". Pattern "agente que se llama a sí mismo via MCP" es la base del *agent-hooks HTTP loopback* en spec — pero esto lo extiende a herramientas semánticas (no solo hooks).
**Cómo traducir:** `crates/apohara-mcp/` con bin `apohara-mcp` que tiene `--mode global|orchestration` (alias del orchestrator). Tools: `get_orchestration_context`, `submit_verdict`, `request_decomposition`, `query_ledger`, `list_dispatches`, `propose_consolidation`. Port file en `~/.apohara/port` para discovery.
**Valor:** MEDIO-ALTO – clave para que agents en plena orquestación puedan consultar/contribuir al estado del coordinator sin tener que parsear su propia salida.

---

## 7. **Worktree Manager con lock global + retry + cleanup comprehensivo**

**Qué:** `WorktreeManager` Rust con un `LazyLock<Mutex<HashMap<path_str, Arc<tokio::sync::Mutex<()>>>>>` por-path para evitar race conditions. Cada operación: (1) acquire path lock, (2) check si worktree ya está properly set up (filesystem + git metadata via `find_worktree_git_internal_name`), (3) recreate si no, con `comprehensive_worktree_cleanup` (git CLI prefer over libgit2 para mutaciones) + metadata force-cleanup + physical dir removal + `git worktree prune`. Retry una vez si `git worktree add` falla. Maneja edge cases: macOS `/private/` alias, repo dentro de worktree (regression test explícito), inferring git-common-dir cuando no se pasó.
**Dónde:** `/crates/worktree-manager/src/worktree_manager.rs:54-580` completo. Líneas clave: 16-17 (LazyLock global locks), 88-116 (ensure_worktree_exists con lock per-path), 230-264 (comprehensive_worktree_cleanup steps 1-4), 538-580 (test "create_worktree_when_repo_path_is_a_worktree").
**Por qué inspira:** Spec menciona "Worktree reliability" pero sin detalles. Esto es production-grade: cobertura de TODOS los modos de fallo conocidos. Especialmente el approach "prefer git CLI for mutations, libgit2 for queries" es sabiduría dolorosamente adquirida.
**Cómo traducir:** Copiar la estructura tal cual a `crates/apohara-worktree`. Adoptar `git2 = "0.20"` para reads + `tokio::process::Command::new("git")` para mutations. Implementar todos los 4 cleanup steps. Tests con `tempfile::TempDir`. Hook al `apohara-sandbox` para enforce sparse-checkout semantics que `git worktree add` respeta.
**Valor:** ALTO – worktree bugs son los más insidiosos en multi-agent orchestration.

---

## 8. **Approvals/Questions Service con timeout + waiters compartidos**

**Qué:** `Approvals` service usa `DashMap<id, PendingApproval>` + `broadcast::Sender<Patch>` + `oneshot::Sender<ApprovalOutcome>` por request. Returns `Shared<BoxFuture<ApprovalOutcome>>` (ApprovalWaiter) que múltiples consumers pueden await en paralelo. Spawning de timeout watcher con `tokio::select! biased`. Diferencia entre `is_question` (Answered) y tool approval (Approved/Denied) con validación de respuesta. Trait `ExecutorApprovalService` para abstraer backend (real vs Noop para testing).
**Dónde:** `/crates/services/src/services/approvals.rs:30-200`, `/crates/executors/src/approvals.rs:29-91` (trait + NoopExecutorApprovalService para tests).
**Por qué inspira:** Apohara va a necesitar este pattern para *permission patterns* + *agent-hooks*. La `Shared<BoxFuture>` es elegante: el coordinator puede `.await` la decisión mientras la UI también espera, todos del mismo source.
**Cómo traducir:** Aplicar tal cual en `crates/apohara-coordinator/src/permissions.rs`. Emitir patches a `/permissions/{id}` para UI. Timeout configurable por tipo de operación. Trait para mockear en tests del verification-mesh.
**Valor:** ALTO – fundación correcta de permissions/approvals.

---

## 9. **Preview-proxy: iframe subdomain routing + asset injection + Next.js RSC redirect interception**

**Qué:** Server Axum separado (puerto distinto) que enruta requests por subdomain del Host header: `{port}.localhost:{proxy_port}/path` → `localhost:{port}/path`. Strip CSP/X-Frame-Options del response para permitir iframe embedding. Inyecta scripts en HTML: bippy bundle (React DevTools hook pre-React), eruda (mobile devtools), devtools_script (console capture via postMessage), click_to_component (inspect mode). Re-escribe headers de redirect (`Location`, `Refresh`, `x-nextjs-redirect`, `x-*-rewrite`) que apunten a `localhost:{target_port}` para mantener iframe origin. **Especialmente:** detecta Next.js RSC redirects encoded en el flight data body (`{"digest":"NEXT_REDIRECT;type;url;status;"}`) y los convierte en HTTP 307 reales.
**Dónde:** `/crates/preview-proxy/src/lib.rs:1-1275` completo (1275 líneas con tests). Highlight: 366-382 (extract_target_from_host con UUID relay-host support), 596-616 (script injection), 770-830 (detect_rsc_redirect_in_body parsing NEXT_REDIRECT digest), 233-288 (rewrite_redirect_like_header_value).
**Por qué inspira:** Si Apohara quiere preview UI de dev servers (vite, next, etc.) inside-app o quiere que agents puedan inspeccionar UI rendered durante un task, este es el blueprint. Especialmente útil para *custom tool widgets* y *terminal attribution shim* — un proxy similar puede capturar `tool_use_id → command → output` rendering.
**Cómo traducir:** Si Apohara escala a UI preview, `crates/apohara-preview-proxy`. Si solo capture stdout de dev servers, mantener el patrón de header stripping + script injection para attribution. La parte de RSC interception es opcional pero copiable si se soportan Next.js apps.
**Valor:** MEDIO – aplicable si Apohara incluye preview de apps; el código RSC redirect es nivel "researcher".

---

## 10. **Versioned Config Schema (v1→v8 migration chain)**

**Qué:** `crates/services/src/services/config/versions/` tiene `v1.rs` … `v8.rs`. El `Config` type es alias de `versions::v8::Config`. `Config::from(raw_str)` intenta deserializar en cada versión y migra hacia arriba hasta llegar a v8. Cada version conserva fields antiguos como `#[serde(alias = "...")]` y agrega defaults via `#[serde(default = "fn")]`. v8 agrega: `git_branch_prefix` (default "vk"), `pr_auto_description_enabled`, `commit_reminder_enabled`, `relay_enabled`, `showcases`, `language`.
**Dónde:** `/crates/services/src/services/config/mod.rs:35-55`, `/crates/services/src/services/config/versions/v8.rs:5-60`.
**Por qué inspira:** Apohara va a tener un `config.json` que evolucionará. Sin versioning, cada release rompe configs existentes. Este patrón es elegante: un solo type alias, migration chain implícita en `from()`, defaults para campos nuevos.
**Cómo traducir:** `crates/apohara-config/src/versions/{v1.rs, v2.rs, ...}.rs`. Cada version es una struct concreta. `mod.rs` define `pub type Config = versions::vN::Config` y un `From<String> for Config` que itera versions.
**Valor:** ALTO – crítico para producto que evoluciona.

---

## 11. **AGENTS.md scoped + symlink CLAUDE.md→AGENTS.md**

**Qué:** Root `AGENTS.md` es una guía concisa (~60 líneas) con SOLO build/test commands + module map + crate-specific links. **Crate-specific AGENTS.md** en `crates/remote/AGENTS.md`, `docs/AGENTS.md`, `packages/local-web/AGENTS.md`. Symlink `CLAUDE.md → AGENTS.md` así Claude Code lo encuentra automáticamente. Linea explícita: "Do not manually edit shared/types.ts, instead edit crates/server/src/bin/generate_types.rs".
**Dónde:** `/AGENTS.md` completo, `ls -la` muestra `CLAUDE.md -> AGENTS.md` symlink.
**Por qué inspira:** Apohara tiene un `AGENTS.md` pero spec no menciona scoping por crate. Este pattern: root AGENTS.md = navegación, crate AGENTS.md = guidance específica (remote/electricSQL, docs/mintlify, local-web/design system). Es lo que mantiene a Claude en context sin alucinar paths.
**Cómo traducir:** Añadir AGENTS.md por crate clave: `crates/apohara-coordinator/AGENTS.md`, `crates/apohara-sandbox/AGENTS.md`, `crates/apohara-indexer/AGENTS.md`, `packages/apohara-ui/AGENTS.md`. Root AGENTS.md cita link a cada uno. Symlink `CLAUDE.md → AGENTS.md`. Linea explícita "regenerate types via X" para cada generated artifact.
**Valor:** MEDIO-ALTO – aplica directo a la spec actual de Apohara.

---

## 12. **Cross-platform Push Notifications con global injection**

**Qué:** Trait `PushNotifier` + `static GLOBAL_PUSH_NOTIFIER: OnceLock<Arc<dyn PushNotifier>>` que el Tauri app inyecta antes de startup con su `TauriNotifier` nativo. Fallback `DefaultPushNotifier` usa: macOS `osascript display notification`, Linux `notify-rust` (spawn_blocking, swallow ServiceUnknown), Windows/WSL2 PowerShell toast script (con WSL→Windows path conversion cacheada). Sound notifications via `afplay`/`paplay`/`aplay`/PowerShell SoundPlayer. Sound files empotrados en `assets/sounds/*.wav` (8 sonidos incluyendo "cow-mooing", "rooster", "phone-vibration").
**Dónde:** `/crates/services/src/services/notification.rs:13-297`, `/assets/sounds/`, `/assets/scripts/toast-notification.ps1`.
**Por qué inspira:** Apohara tiene Tauri v2 — necesita exactamente este pattern para que el daemon (cuando corre headless via npx) tenga notifications nativas. El "WSL2 path conversion cacheada" es un detalle que falla en TODA orquestación que no lo considere.
**Cómo traducir:** `crates/apohara-notifications/src/lib.rs` con trait + DefaultPushNotifier + WSL path cache. Sound files en `assets/sounds/` (apohara puede usar más sutiles). Tauri app implementa `TauriNotifier` que llama plugin oficial.
**Valor:** MEDIO-ALTO – complemento de Smart Attention (cuando "Needs you" se eleva, fire notification).

---

## 13. **Embedded SSH Server + Editor URL builder (vscode://ssh-remote+)**

**Qué:** `crates/embedded-ssh/` corre un SSH server con `russh = "0.x"` over WebSocket stream (axum WS wrapped en `AxumWsStreamIo`). Auth via Ed25519 public key match contra relay signing sessions. `crates/desktop-bridge/src/service.rs` genera URLs `vscode://vscode-remote/ssh-remote+vk-{alias}{path}?windowId=_blank` (soporta Zed, Cursor, Windsurf, Antigravity, VSCode Insiders) y manipula `~/.ssh/config` con un `Include` directive.
**Dónde:** `/crates/embedded-ssh/src/lib.rs:15-24` (run_ssh_session), `/crates/embedded-ssh/src/handler.rs`, `/crates/desktop-bridge/src/service.rs:22-62` (open_remote_editor + build_editor_url tests).
**Por qué inspira:** Workspaces remotos accesibles via "Open in VSCode" desde la app — patrón perfecto si Apohara escala a multi-machine orchestration. El "manipular ssh config con Include" evita pisar configs del usuario.
**Cómo traducir:** Si Apohara soporta dispatch remoto, `crates/apohara-ssh-bridge`. Mientras tanto, el patrón de generación de URLs editor (con soporte multi-editor) es directamente útil para botón "Open in Editor" en cualquier dispatch local.
**Valor:** BAJO-MEDIO (a menos que multi-host esté en roadmap), pero el URL builder es copiable hoy.

---

## 14. **Dev environment setup script: ports auto-allocation + seed assets copy**

**Qué:** `scripts/setup-dev-environment.js` busca 3 puertos libres (frontend/backend/preview_proxy) starting from 3000, los persiste en `.dev-ports.json`, verifica disponibilidad en cada `pnpm run dev`, y copia `dev_assets_seed/` → `dev_assets/` (incluye `config.json` con onboarding ya acknowledged + `db.sqlite` seed) si no existe. Comandos: `get`, `frontend`, `backend`, `preview_proxy`, `clear`. Honra `PORT` env si está set.
**Dónde:** `/scripts/setup-dev-environment.js:14-262`, `/dev_assets_seed/config.json` (theme, executor type, onboarding_acknowledged, sound_file), `/dev_assets_seed/db.sqlite` (empty seeded DB).
**Por qué inspira:** Onboarding dev de Apohara es probablemente "edita config, allocá puertos manualmente". Este pattern hace `pnpm run dev` o `bun dev` *just work*, sin colisiones de puertos, con DB pre-seeded saltando todo onboarding.
**Cómo traducir:** `scripts/setup-dev-environment.ts` (bun) que aloca puertos para coordinator/sandbox/indexer/UI. `dev_assets_seed/config.json` con `onboarding_acknowledged: true`. `dev_assets_seed/orchestration.db` con seed mínimo (1 orchestration de ejemplo).
**Valor:** ALTO – DX inmediata.

---

## 15. **`enum_dispatch` para `CodingAgent` polymorphism sin Box<dyn>**

**Qué:** `#[enum_dispatch] pub enum CodingAgent { ClaudeCode, Amp, Gemini, Codex, ... }` + `#[enum_dispatch(CodingAgent)] pub trait StandardCodingAgentExecutor { fn spawn(...); fn spawn_follow_up(...); fn normalize_logs(...); fn default_mcp_config_path(...); ... }`. Cada variant implementa el trait, `enum_dispatch` genera el dispatch sin allocation. Combinado con `strum::EnumDiscriminants` para tener `BaseCodingAgent` enum SCREAMING_SNAKE_CASE serializable + sqlx Type + ts-rs ts-enum.
**Dónde:** `/crates/executors/src/executors/mod.rs:94-202` (CodingAgent enum + StandardCodingAgentExecutor trait + capabilities), `/Cargo.toml deps` (`enum_dispatch = "0.3.13"`, `strum = "0.27"`, `strum_macros = "0.27"`).
**Por qué inspira:** Apohara va a tener varios providers (claude/codex/opencode/...) — este es el pattern correcto en Rust. Más rápido que `Box<dyn StandardCodingAgentExecutor>`, type-safe, exhaustive match enforced.
**Cómo traducir:** `crates/apohara-providers/src/lib.rs` con `#[enum_dispatch] pub enum Provider { Claude(ClaudeProvider), Codex(CodexProvider), OpenCode(OpenCodeProvider) }` + `pub trait ProviderExecutor { fn spawn_pure(...), fn parse_output(...), fn capabilities() -> Vec<Capability> }`. `BaseProvider` discriminants via strum.
**Valor:** ALTO – arquitectura recomendada para BaseAgentProvider refactor.

---

## 16. **Capabilities-based feature flags por agente**

**Qué:** `enum BaseAgentCapability { SessionFork, SetupHelper, ContextUsage }`. Cada agente declara su set: ClaudeCode = [SessionFork, ContextUsage]; Codex = [SessionFork, SetupHelper, ContextUsage]; Gemini = [SessionFork]; CursorAgent = [SetupHelper]; Amp/Copilot/Droid = []. UI consulta `agent.capabilities()` para mostrar/ocultar botones (fork session, setup helper button, token meter).
**Dónde:** `/crates/executors/src/executors/mod.rs:55-65, 177-201`.
**Por qué inspira:** Apohara tiene N providers heterogéneos. En lugar de hardcodear "claude soporta esto, codex no", declarative capabilities. Crítico para custom tool widgets (mostrar widget X solo si provider tiene capability Y).
**Cómo traducir:** `enum Capability { TwoTierTranscript, RosterHardening, DriftDetection, SessionFork, NativeTools, ContextUsage, JsonStream, SlashCommands }`. `Provider::capabilities() -> Vec<Capability>`. UI usa `useCapability(provider, Capability::X)` hook.
**Valor:** ALTO.

---

## 17. **Sound alerts con files empotrados + UI elección**

**Qué:** 8 sound files curados en `/assets/sounds/` (`abstract-sound1-4.wav`, `cow-mooing.wav`, `fahhhhh.wav`, `phone-vibration.wav`, `rooster.wav`). Embedded en binario via `rust-embed`. Usuario elige uno en settings (`config.sound_file: "abstract-sound4"`). UI selector permite preview.
**Dónde:** `/assets/sounds/`, `/dev_assets_seed/config.json:9` (`"sound_file": "abstract-sound4"`), `/crates/server/Cargo.toml:62` (`rust-embed = "8.2"`).
**Por qué inspira:** Smart Attention "Needs you" fires audio — tener un mini-pack de sonidos custom (no solo system beep) hace la app memorable. Cow-mooing es un detalle que se nota.
**Cómo traducir:** `assets/sounds/apohara-{ready,needs-you,done,error}.wav` curados (sutiles, no irritantes). `rust-embed` para empotrar. Settings UI con preview button.
**Valor:** BAJO-MEDIO (delight, no funcional).

---

## 18. **Per-executor `default_profiles.json` con permission overrides**

**Qué:** Archivo `default_profiles.json` empotrado que define para cada executor el variant DEFAULT con su key crítica de permission override: `CLAUDE_CODE.dangerously_skip_permissions: true`, `CODEX.sandbox: "danger-full-access"`, `GEMINI.yolo: true`, `OPENCODE.auto_approve: true`, `CURSOR_AGENT.force: true, model: "auto"`, `COPILOT.allow_all_tools: true`, `DROID.autonomy: "skip-permissions-unsafe"`. JSON schemas separados por agente en `/shared/schemas/{amp,claude_code,codex,copilot,cursor_agent,droid,gemini,opencode,qwen_code}.json`.
**Dónde:** `/crates/executors/src/default_profiles.json:1-67`, `/shared/schemas/*.json` (9 files JSON Schema draft-07 con properties como append_prompt/plan/approvals/model/effort/agent/...).
**Por qué inspira:** Apohara `--pure` mode requiere desactivar permisos en cada CLI. Tener un mapping declarativo + JSON Schemas para validar configs es crítico. El esquema sirve doble como contrato de UI form gen.
**Cómo traducir:** `crates/apohara-providers/default_pure_profiles.json` por provider. JSON schemas en `shared/schemas/` para form generation y validation. Ejemplo: `claude.json` con `dangerously_skip_permissions, append_prompt, plan, approvals, model, effort, agent` properties.
**Valor:** ALTO – formaliza el "pure mode" requirement.

---

## 19. **Crate-granularity workspace (38+ crates, single-responsibility)**

**Qué:** El Cargo workspace tiene 38 miembros, cada uno una responsabilidad clara: `api-types` (shared types), `db` (SQLx), `executors`, `services`, `worktree-manager`, `workspace-manager`, `git`, `git-host`, `mcp`, `preview-proxy`, `desktop-bridge`, `embedded-ssh`, `relay-*` (8 crates para relay/tunnel system), `tauri-app`, etc. `exclude = ["crates/remote", "crates/relay-tunnel"]` para crates con deps incompatibles.
**Dónde:** `/Cargo.toml:1-35` workspace members.
**Por qué inspira:** Apohara mencionó "crates/" en plural. Este granularity (NO mono-crate "apohara") es la forma correcta. Cada crate compila independientemente, testing aislado, reuso entre bins (server/mcp/review/tauri comparten executors).
**Cómo traducir:** Apohara crates: `apohara-types`, `apohara-config`, `apohara-coordinator`, `apohara-providers`, `apohara-mcp`, `apohara-sandbox`, `apohara-indexer`, `apohara-ledger`, `apohara-verification`, `apohara-consolidator`, `apohara-decomposer`, `apohara-scheduler`, `apohara-worktree`, `apohara-cli`, `apohara-tauri-app`, `apohara-notifications`, `apohara-git`, `apohara-github`, `apohara-utils`. Compartiendo workspace.dependencies para versions consistentes.
**Valor:** ALTO – arquitectura recomendada.

---

## 20. **`spawn_blocking` para libgit2 + non-blocking await orchestration**

**Qué:** Todo trabajo libgit2 (que es sync/blocking) se envuelve en `tokio::task::spawn_blocking(move || { GitService::new().add_worktree(...) }).await.map_err(...)?`. Esto libera el reactor Tokio durante operaciones git largas (clone, fetch, prune). Pattern consistentemente aplicado en `worktree_manager.rs`.
**Dónde:** `/crates/worktree-manager/src/worktree_manager.rs:69-79, 138-142, 163-182, 268-300, 314-365`.
**Por qué inspira:** Apohara va a hacer mucho git. Bloquear el reactor con libgit2 mata la concurrency. Este pattern es no negociable.
**Cómo traducir:** Cualquier libgit2 call en Apohara: `tokio::task::spawn_blocking(move || { ... }).await?`. Mismo para tree-sitter parses largas (en apohara-indexer).
**Valor:** ALTO – correctness fundacional.

---

## Bonus rápidos

- **`patches/`** dir en root: vibe-kanban tiene patches a deps externas (pnpm patches). Apohara puede usar mismo pattern si necesita parchear crates upstream.
- **`Caddyfile.example`** para reverse proxy guide en docs — pattern útil para self-hosting.
- **`mobile-testing.md`** en root: doc explícito de mobile testing flow. Apohara mobile/Tauri Android es lejos pero tener doc dedicada es buena práctica.
- **`rustfmt.toml` + `rust-toolchain.toml`** committed → reproducible builds.
- **`build-tauri-msi.js`** scripts para Windows installer custom — referencia si Apohara empaqueta Tauri MSI.
- **i18n con `check-unused-i18n-keys.mjs`** linter script — Apohara va a necesitar i18n eventualmente.
- **`check-legacy-frontend-paths.sh`** que falla CI si código importa de paths viejos — pattern para migrations frontend.
- **Docs en Mintlify MDX** con CLAUDE.md específico para writing style — el `docs/CLAUDE.md` muestra cómo establecer voice/components rules para AI doc writing.

---

## Recomendación de priorización para Apohara v1.0

1. **MCP Config Adapter Pattern** (#1) + **JSONC con preservation** (#2) + **`ts-rs`** (#4) — son ASAP, baja inversion, alto payoff inmediato.
2. **JSON-Patch streaming** (#3) + **Approvals service** (#8) — fundación correcta del realtime UI/coordinator contract.
3. **Worktree Manager pattern** (#7) + **`spawn_blocking`** (#20) + **`enum_dispatch` Providers** (#15) + **Capabilities** (#16) — correctness fundacional del backend.
4. **NPX-CLI distribution** (#5) + **MCP server dual-mode** (#6) — distribución para usuarios casuales.
5. **Versioned Config** (#10) + **Crate-granularity** (#19) + **AGENTS.md scoped** (#11) — escalabilidad de codebase y producto.
6. **Push Notifications cross-platform** (#12) + **Sound files** (#17) + **Default pure profiles + JSON Schemas** (#18) — complementan Smart Attention + Permission Patterns.
7. **Dev setup script** (#14) — DX.
8. **Preview-proxy** (#9) y **embedded SSH** (#13) — opcionales según roadmap.