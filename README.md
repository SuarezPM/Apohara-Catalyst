# Apohara

> **The first open-source multi-AI coding orchestrator.** Write a prompt
> once. Apohara decomposes it into microtasks and dispatches each one to
> the AI that does it best — Claude plans, GPT codes, Gemini verifies —
> using **your existing subscriptions**, not API keys.

```
┌──────────────────────────────────────────────────────────────────────┐
│  apohara                                       ◈ Claude · GPT · Gemini│
├───────────────┬──────────────────────────┬─────────────────────────-─┤
│  Objective    │   Swarm Canvas (DAG)     │  Code + Diff              │
│               │                          │                           │
│  build CRUD   │   ┌─planner (Claude)─┐   │  + src/api/users.ts       │
│  endpoint     │   └──┬───────────────┘   │  ~ src/db/schema.ts       │
│  with auth    │      ▼                   │                           │
│               │   ┌─coder (GPT) ──┐    │  ┌──── verification ────┐ │
│  [Enhance ▾]  │   └──┬──────────────┘    │  │ judge (Gemini) ✓     │ │
│  [Run ▶]      │      ▼                   │  │ critic (Claude) ✓    │ │
│               │   ┌─verifier (Gemini)┐ ⚖ │  └──────────────────────┘ │
└───────────────┴──────────────────────────┴───────────────────────────┘
```

Type the intent. The right AI handles each step. The verification mesh
makes a **different** AI audit the result before it merges.

## Why Apohara

There are good tools to **call one AI from your editor** (Cursor, Cline,
Continue). There are good tools to **manage multiple AI sessions side
by side** (Nimbalyst). There is no tool that takes **one prompt**,
splits it into parts, and orchestrates **several AIs collaborating on
the same task** — with a different AI verifying the result so a single
model's blind spots can't ship code.

That gap is Apohara.

| You want… | Today you use | With Apohara |
|---|---|---|
| One AI in your editor | Cursor / Cline / Continue | Apohara works too, single-provider mode |
| Multiple AI sessions, separate tasks | Nimbalyst, manual tab juggling | Apohara orchestrates a single task across them |
| One AI does the work, *another* audits it | Custom prompts, hope for the best | Built-in dual-arbiter verification mesh (INV-15 safety gate) |
| Bring your own subscriptions, not API keys | Run each CLI manually | Apohara drives your local `claude` / `codex` / `gemini` CLIs as providers |
| Cost-free dev runs on your own GPU | Self-host vLLM, glue it yourself | Optional Carnice 9B + Apohara ContextForge: 79% token savings, measured |

## Status

**v0.1 alpha — current.** Multi-AI orchestrator, syscall-level sandbox,
and the desktop visual surface are all shipping. See
[`ROADMAP.md`](ROADMAP.md) for the milestone plan; see
[`ARCHITECTURE.md`](ARCHITECTURE.md) for the deep dive.

| Capability                                              | Status |
|---|---|
| **Multi-AI orchestration: prompt → DAG → per-microtask routing** | ✅ |
| **Dual-arbiter verification mesh (judge ≠ critic ≠ coder)** | ✅ |
| **CLI-driver providers (Claude Code, Codex, Gemini-CLI, opencode)** | ✅ |
| **Pick-your-roster UI: enable/disable any provider per run**  | ✅ |
| 21 cloud providers + Gemini OAuth                              | ✅ |
| Event ledger v2 with SHA-256 hash chain + replay               | ✅ |
| Vibe DAG decomposition with cycle detection                    | ✅ |
| Code intelligence: tree-sitter + redb + Nomic BERT             | ✅ |
| Syscall sandbox (seccomp-bpf + user/mount/PID namespaces)      | ✅ M014 |
| Desktop visual surface (Tauri + React + SSE)                   | ✅ M017 |
| **Optional**: ContextForge GPU sidecar (79% token savings)     | ✅ M015 |
| 90-second viral demo + HN launch                               | ⏳ Phase 6 |
| Self-improvement loop (`apohara auto "ship X"`)                | ⏳ v0.2 |

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/SuarezPM/Apohara/main/scripts/install.sh | sh
```

Or from source:

```bash
git clone https://github.com/SuarezPM/Apohara
cd Apohara
bun install
bun run build
```

The single-binary distribution (Linux ELF 5.6 MB, macOS `.dmg`, Windows
`.msi`) lands automatically on every tag push via the
[desktop-release workflow](.github/workflows/desktop-release.yml).

## Quick start

```bash
# Desktop mode — the visual surface
cd packages/desktop
bun run dev          # http://localhost:7331

# CLI mode — useful in CI and headless contexts
bun run src/cli.ts auto "Implement JWT auth on /api/login"
```

Open the desktop. In the top bar, tick the AIs you want to bring to
this run (Claude · GPT · Gemini · Carnice-local · …) — the roster
persists across sessions. Drop your objective in the left pane, hit
**Enhance** to let the planner LLM rewrite it for clarity, then
**Run**. The DAG appears in the center as the decomposer emits tasks;
each task is dispatched to the AI that scores highest for that role,
and the verification mesh forces a *different* AI to audit the diff
before it merges.

### Bring your own subscriptions (no API keys needed)

Apohara ships **CLI-driver providers** so it can drive your existing
official agent CLIs — your subscription auth, your TOS, your rate
limits:

| Provider id | Driver binary | Get it from |
|---|---|---|
| `claude-code-cli` | `claude` | [@anthropic-ai/claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code) |
| `codex-cli` | `codex` | [@openai/codex](https://www.npmjs.com/package/@openai/codex) |
| `gemini-cli` | `gemini` | [@google/gemini-cli](https://www.npmjs.com/package/@google/gemini-cli) |
| `opencode-go` | `opencode --pure` | [sst/opencode](https://github.com/sst/opencode) |

When a CLI is on `$PATH`, the matching provider is auto-enabled. If you
also want raw API access, set the matching API key (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, etc.) and Apohara prefers the CLI driver first,
falling back to the API on failure.

## Use cases

| Intent | What apohara does (with roster `Claude + GPT-4 + Gemini`) |
|---|---|
| `"Add CRUD for /api/products"` | Claude plans the four-task DAG, GPT-4 writes schema + routes, Gemini writes tests + docs, mesh runs `bun test`, judge (Gemini) + critic (Claude) approve, green PR opens |
| `"Migrate src/legacy/* off lodash"` | Indexer maps every consumer; GPT-4 patches each file in parallel; Claude verifies semantic equivalence on every diff; mesh merges in dependency order; one failed verification rolls the whole task back |
| `"Fix the flake in tests/ledger.test.ts"` | Replays the failing run from the event ledger, reproduces inside the sandbox; Claude proposes the fix, GPT-4 stress-tests with 3 consecutive runs, Gemini critiques the test for false positives |

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA DESKTOP (Tauri v2, ~6 MB single binary)                     │
│  React 19 + Geist + @xyflow/react + Monaco + Lexical                 │
└─────────────────────────── ↕ HTTP :7331 (Bun.serve) ─────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA CORE (TypeScript on Bun)                                    │
│  decomposer · scheduler · verification-mesh · ledger (Phase 4 chain) │
│  router (21 providers + OAuth) · subagent-manager · consolidator     │
└─────────────────────────── ↕ Unix Domain Sockets ────────────────────┘
┌──────────────────────────────┬───────────────────────────────────────┐
│  apohara-indexer (Rust) ✅   │  apohara-sandbox (Rust) ✅ M014       │
│  tree-sitter + redb + BERT   │  seccomp-bpf + user/mount/PID ns      │
└──────────────────────────────┴───────────────────────────────────────┘
                              ↕ HTTP :8001 (optional)
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA CONTEXT FORGE (parallel repo, Python + vLLM, optional)      │
│  KV-cache coordinator · INV-15 safety gate                           │
└──────────────────────────────────────────────────────────────────────┘
```

Deeper dive: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Sandbox — what it actually does

The `apohara-sandbox` Rust binary runs every untrusted command inside:

1. A **user + mount + PID namespace bundle** (unprivileged, via
   `CLONE_NEWUSER | CLONE_NEWNS | CLONE_NEWPID`). The agent sees PID 1
   and cannot enumerate or signal host processes.
2. A **seccomp-bpf filter** sized per permission tier (`ReadOnly`,
   `WorkspaceWrite`, `DangerFullAccess`). Blocked syscalls return EPERM
   so the agent observes a normal failure rather than dying with SIGSYS.
3. Cryptographically-anchored audit: every execution emits a
   `sandbox_execution` rollup + one `security_violation` event per
   blocked syscall to the SHA-256-chained event ledger. `apohara replay`
   reconstructs the entire run.

Non-Linux hosts fall back to a consent-gated unsandboxed mode:
`APOHARA_ALLOW_UNSANDBOXED=1` opts in and logs `sandbox_bypassed`.

## Optional booster: ContextForge GPU sidecar

Apohara is cloud-first by design — Claude, GPT-4, Gemini and the other
21 providers do the work via their CLIs or APIs. If you also happen to
have a CUDA or ROCm GPU lying around, you can plug
[Apohara · ContextForge](https://github.com/SuarezPM/Apohara_Context_Forge)
in as a sidecar to compress, deduplicate, and reuse KV context across
your multi-AI calls. On a 5-agent benchmark (preprint
DOI [10.5281/zenodo.20114594](https://doi.org/10.5281/zenodo.20114594))
the sidecar measured **79.85% token savings** end-to-end. Paired with a
local LLM server (llama-cpp-python serving
[`kai-os/Carnice-9b-GGUF`](https://huggingface.co/kai-os/Carnice-9b-GGUF)),
dev iterations can cost effectively **zero cloud tokens**.

This is **strictly optional**. Apohara works unchanged when
`CONTEXTFORGE_ENABLED` is unset; every ContextForge call is best-effort
and silently falls back to the original context on any failure.

### Quick start — NVIDIA, no Docker

```bash
git clone https://github.com/SuarezPM/Apohara_Context_Forge.git ~/Apohara-ContextForge
cd ~/Apohara-ContextForge

uv venv .venv --python 3.12
source .venv/bin/activate
uv pip install -e .

# Boot the sidecar
nohup python -m apohara_context_forge.main > /tmp/contextforge.log 2>&1 &

# Tell Apohara to use it
export CONTEXTFORGE_ENABLED=1
export CONTEXTFORGE_URL=http://localhost:8001
```

## License

MIT. See [`LICENSE`](LICENSE).

## Contributing

This repo is indexed by [GitNexus](https://github.com/SuarezPM/GitNexus) —
when you touch a hub symbol, run `gitnexus_impact()` first and quote the
blast radius in the PR description. `CLAUDE.md` captures the full
engineering contract; `ROADMAP.md` captures the milestone plan; this
README is the launch surface, not the spec.
