# Getting started with Apohara

> Five-minute quickstart. From "never heard of Apohara" to "watching the
> kanban move on its own."

## Prerequisites

You need at least one of the three sanctioned CLI providers on `$PATH`:

- [`@anthropic-ai/claude-code`](https://www.npmjs.com/package/@anthropic-ai/claude-code) — the `claude` binary.
- [`@openai/codex`](https://www.npmjs.com/package/@openai/codex) — the `codex` binary.
- [`sst/opencode`](https://github.com/sst/opencode) — the `opencode` binary.

Apohara never touches your auth. The CLIs authenticate against your existing
subscriptions; Apohara just dispatches tasks to them over stdio.

Also recommended (but optional):

- Node ≥ 20 (for `npx apohara`).
- A modern browser (the desktop UI runs in any Chromium / Firefox / Safari).
- Git, because Apohara writes commits.

## 1. Install

The fastest path uses `npx` — no global install, no PATH surgery:

```bash
npx apohara@latest --version
```

The `npx` wrapper downloads the prebuilt binary for your platform from
GitHub Releases, verifies the SHA-256 sidecar, and caches it under
`~/.npm/_npx/`. Subsequent invocations reuse the cached binary.

For a permanent install, prefer the one-liner installer:

```bash
curl -fsSL https://raw.githubusercontent.com/SuarezPM/Apohara/main/scripts/install.sh | sh
```

This drops `apohara-desktop` and `apohara` (CLI) into `${APOHARA_PREFIX:-$HOME/.local}/bin`.
Override the destination with `APOHARA_PREFIX=/usr/local` if you want it
system-wide.

Homebrew users:

```bash
brew install SuarezPM/apohara/apohara
```

## 2. Verify your environment

```bash
apohara doctor
```

`apohara doctor` walks seven sections in order: `runtime`, `roster`, `policy`,
`sandbox`, `ledger`, `mcp`, `assigned`. It exits non-zero on the first
failure, prints a hint that maps the failure to the doc / config that fixes
it, and reports the rest of the sections so you can see the full picture.

Expected output on a fresh, healthy install:

```
[runtime   ] OK   Bun 1.3.x · rustc 1.95.x
[roster    ] OK   claude · codex · opencode all on PATH
[policy    ] OK   Balanced preset · 6 enforcement areas (4 enforced)
[sandbox   ] OK   apohara-sandbox crate present
[ledger    ] OK   no DB yet (fresh install)
[mcp       ] OK   no MCP bootstrap yet
[assigned  ] OK   DB present — use `apohara verify-setup` for verdict

Apohara setup verified end-to-end.
```

If any section fails, read the hint, fix the underlying problem, and rerun.
The most common one is `roster` — install whichever CLI is missing and
re-source your shell.

## 3. Run the UI

```bash
cd packages/desktop
APOHARA_DESKTOP_PORT=7331 bun --hot src/server.ts
```

Open `http://localhost:7331` in your browser. You should see an empty kanban
(four columns: Backlog, In progress, Verification, Done) with an empty-state
banner offering a "+ Seed demo tasks" button.

## 4. Seed the demo

Click **+ Seed demo tasks**. Apohara enrols five canned tasks that exercise
the whole pipeline: a planner task on `claude`, a coder task on `codex`, an
explorer task on `opencode`, a duplicate-claim regression test, and an
INV-15-gated end-to-end task.

You'll see the cards move across columns in real time as each provider
finishes its step. The Verification footer expands when a task hits the
judge / critic / invariants gate.

## 5. Hand Apohara real work

```bash
apohara plan "Add a /health endpoint that returns the git SHA"
```

`apohara plan` creates a SPEC document, dispatches it through the scheduler
with your configured roster, and streams progress to the desktop UI (or
`--headless` for CI). The first dispatch may take ~30 s while the
verification mesh warms up; subsequent dispatches are near-instant because
the planner / critic models reuse the in-process context.

While Apohara works, watch the kanban in the browser. Each card carries the
provider that ran it, the verdict from the verification mesh, and a link to
the ledger entry that proves the result is replayable.

## What next

- Read [`docs/architecture.md`](architecture.md) to understand the runtime.
- Read [`PRINCIPLES.md`](../PRINCIPLES.md) for the design commitments.
- Read [`docs/troubleshooting.md`](troubleshooting.md) when something
  breaks — it carries the answers to every `apohara doctor` failure mode and
  the top 10 first-run issues.
- Tweak the policy preset in `.apohara.json` (`Strict` / `Balanced` /
  `Advisory` / `ExternalSandbox`) — the four presets ship in
  `src/core/safety/runnerPolicy/presets.ts`.
- Wire the GitHub bridge for poll-based issue → PR automation
  ([`docs/github-app-setup.md`](github-app-setup.md)).

If you get stuck, open an issue with the output of `apohara doctor --json`
and the relevant slice of `~/.apohara/replay.jsonl`. That's a reproducible
bug report; the rest are guesses.
