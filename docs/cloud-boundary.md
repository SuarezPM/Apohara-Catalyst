# Cloud Boundary — Apohara v1.0

> Status: normative for v1.0. Reviewers and auditors: this file enumerates
> every byte that may leave the local host. Anything not listed here is a bug.

Apohara v1.0 is a local-first orchestrator. The only processes that contact
external services are (a) the user's own provider CLIs (Claude Code / Codex /
OpenCode), invoked as subprocesses, and (b) the `github-bridge` poller, which
talks to `api.github.com` on the user's behalf via a GitHub App.

This document names the exact files, sockets, processes, and network calls so
that what crosses the local↔cloud boundary is unambiguous.

## 1. What stays local

Every artifact in this section is created and consumed entirely on the user's
machine. None is ever uploaded by Apohara to any service. All paths default to
`$HOME/.apohara/` and are configurable through the `apoharaHome` option in the
TypeScript runtime (see `src/cli/doctor.ts:129` for the default resolution).

| Artifact | Default path | Source of truth |
|---|---|---|
| Orchestration DB (bun:sqlite) | `~/.apohara/orchestration.db` | `src/cli/doctor.ts:93`, `src/cli/doctor.ts:120` |
| Per-run event ledger (JSONL) | `<repo>/.events/run-<runId>.jsonl` | `src/providers/github.ts:31`, `src/providers/router.ts:402`, `packages/desktop/src/server.ts:292` |
| MCP endpoint descriptor | `~/.apohara/sockets/mcp-endpoints.json` | `src/core/mcp/bootstrap.ts:43` |
| Hook server endpoint descriptor | `~/.apohara/sockets/hooks-endpoint.json` | `crates/apohara-hooks-server/src/endpoint_file.rs:3,73` |
| Indexer database (redb) | `~/.apohara/index.redb` | `crates/apohara-indexer/src/db.rs:4,93`, `crates/apohara-indexer/src/indexer.rs:92` |
| Indexer IPC socket | `<cwd>/.apohara/indexer.sock` | `crates/apohara-indexer/src/server.rs:20`, `src/core/indexer-client.ts:64` |
| MCP / audit log (JSONL, fchmod 0600) | `~/.apohara/audit/*.jsonl` (default `mcp.jsonl`) | `src/core/mcp/bootstrap.ts:48`, `crates/apohara-audit/AGENTS.md:8` |
| Secrets (bearer tokens, GitHub App key path) | OS keychain via `apohara-secrets` (no on-disk plaintext) | `crates/apohara-secrets/Cargo.toml`, `crates/apohara-secrets/AGENTS.md` |
| Worktrees (per-task git checkouts) | `<repo>/.claude/worktrees/<adjective>-<noun>-<id>` | `crates/apohara-worktree/src/lifecycle.rs:11`, `src/core/worktree-manager.ts:2,11` |
| Per-run output artifacts | `<repo>/.apohara/runs/` | `src/core/summary.ts:79` |
| Consolidator state file | `<repo>/.apohara/state.json` | `src/core/consolidator.ts:39`, `src/core/summary.ts:78` |
| Apohara settings file | `~/.apohara/settings.json` | `src/core/mcp/bootstrap.ts:49` |

Notes:

- The path `~/.apohara/ledger/*.jsonl` is reserved by spec language but is not
  the path actually written by v1.0 code. The per-run JSONL ledger lives at
  the repository-scoped `.events/run-<id>.jsonl` shown above. Treat the
  `~/.apohara/ledger/` form as configurable via `apoharaHome` and currently
  unused; the audit JSONL at `~/.apohara/audit/` is the always-on local sink.
- The `apohara-secrets` crate wraps `keyring-rs` and delegates to Secret
  Service (Linux), Keychain (macOS), or Credential Vault (Windows). Apohara
  never reads or stores credentials in plaintext on disk.
- The Nomic BERT model (~400 MB) used by `apohara-indexer` is downloaded
  once from HuggingFace by the user and then run locally on CPU — no
  embedding request ever leaves the host (`crates/apohara-indexer/src/embeddings.rs:4,11,62`).

## 2. What crosses the boundary

Three and only three categories of bytes leave the host in v1.0.

### 2.1 Provider CLI subprocesses

`BaseAgentProvider.spawn` (`src/core/providers/BaseAgentProvider.ts`) launches
the user's installed provider binary — `claude` (Claude Code CLI), `codex`
(Codex CLI), or `opencode` (OpenCode CLI) — as a child process per task.
Those subprocesses speak to the provider's own API using credentials that
the CLI itself manages (typically via the user's prior `claude login`, OAuth
flow, or stored key). Apohara never reads those credentials and never POSTs
to a provider API directly.

The spawn path goes through `sanitizeEnv` first
(`src/core/persistence/envSanitizer.ts:95`, `BaseAgentProvider.ts:8,46`),
which strips every variable whose name matches the API-key denylist from the
inherited environment before handing it to the child. This enforces spec
§0.4: a subprocess only ever sees the credentials it explicitly needs.

### 2.2 `github-bridge` poll-only

`packages/github-bridge/src/poller.ts:44` polls
`api.github.com/repos/.../issues?labels=apohara&state=open` every 60 seconds.
Authentication is a JSON Web Token signed locally with the GitHub App private
key (`packages/github-bridge/src/github-app-auth.ts:1-50`) and exchanged for
an installation token cached with a 50-minute TTL. The same client opens PRs
and posts comments on behalf of the user when tasks complete
(`packages/github-bridge/src/pr-builder.ts`, `poller.ts:60-67`).

The HTTP user-agent is `apohara-github-bridge/1.0`
(`packages/github-bridge/src/octokit-client.ts:20`). Permissions required by
the App are `issues:write`, `pull_requests:write`, `contents:read` — see
`docs/github-app-setup.md` for the install steps.

### 2.3 Crash / telemetry / analytics

**v1.0 default: zero outbound bytes from the telemetry path.**

The `src/core/telemetry/` module exists in the codebase to satisfy spec
§0.33, but in v1.0 it is gated by an `enabled: false` constructor flag and
additionally killed by `APOHARA_TELEMETRY_DISABLED=1`
(`src/core/telemetry/index.ts:82-92`). No release of v1.0 ships a transport
that hits the network, and `init` does not write `telemetry: { enabled: true }`
into `~/.apohara/settings.json`. There is no crash reporter, no analytics
beacon, no auto-update phone-home. Removing the telemetry directory would
not change observable network behaviour in v1.0.

## 3. What does NOT cross the boundary

Negatives, so reviewers do not have to assume:

- **Provider API keys** — never read, never logged, never POSTed by Apohara.
  The provider CLI owns its own credential transport.
- **Source code outside the worktree** — sandboxed by
  `crates/apohara-sandbox` (seccomp-bpf + Linux namespaces) and pre-validated
  by `crates/apohara-pathsafety` symlink-escape detection
  (`crates/apohara-pathsafety/src/lib.rs:20,48`).
- **Index embeddings** — Nomic BERT runs locally on CPU; embeddings are
  written only to `~/.apohara/index.redb`.
- **Decomposer prompts, plan documents, agent stdin/stdout** — handed to the
  provider CLI subprocess via stdin / argv only. Apohara itself does not
  POST them anywhere. Whatever the provider CLI then transmits over its
  own connection is governed by that CLI's network behaviour, not Apohara's.
- **Issue titles / PR bodies / branch names / commit SHAs / file paths** —
  the telemetry denylist (`src/core/telemetry/index.ts:39-51`) blocks them
  by key name even if telemetry is ever enabled. Strings are additionally
  truncated to 200 chars (`MAX_STRING_LENGTH`) before any hypothetical send.
- **Inbound webhooks** — the webhook stub at
  `packages/github-bridge/src/webhook.ts` returns a deferred message; v1.0
  does not accept inbound HTTP from GitHub.

## 4. Audit hooks

Mechanisms a user or auditor can use today to confirm the boundary:

- **`apohara doctor`** — section `mcp`
  (`src/cli/doctor.ts:105-117`) inspects the MCP endpoint descriptor and
  confirms 4 internal MCP servers are present. All four bind to
  `127.0.0.1` (`src/core/mcp/base/McpServer.ts:41`); a non-loopback bind
  would surface as a separate finding.
- **`~/.apohara/audit/`** — default JSONL audit sink fchmod-0600
  (`crates/apohara-audit/AGENTS.md:30`). Every MCP tool invocation and every
  github-bridge call SHOULD be logged here by the call site
  (`src/core/mcp/bootstrap.ts:48`, `bootstrap.ts:53-56`). Default path; the
  full directory is configurable through `auditLogPath` / `apoharaHome`.
- **`lsof -i -P -n | grep -i apohara`** — at steady state should show only
  the 4 loopback MCP servers on `127.0.0.1:<random>` plus, while polling,
  the github-bridge poller's outbound TLS to
  `api.github.com:443`. Any other listener or outbound connection is a
  regression to investigate.

## 5. v1.1+ changes that would expand the boundary

Out of scope for v1.0; tracked so reviewers know what the v1.0 surface
intentionally excludes:

- **Inbound webhook delivery worker** — accepting GitHub webhook payloads
  on a public-reachable HTTPS endpoint. The stub at
  `packages/github-bridge/src/webhook.ts:2-19` exists only to reserve the
  URL path.
- **Outbound telemetry transport** — only if the user explicitly opts in via
  `~/.apohara/settings.json` (`telemetry.enabled = true`) AND a release
  ships a real transport. Both gates are required; v1.0 ships neither.
- **Hosted GitHub App / Marketplace listing** — v1.0 is self-hosted; the
  user installs their own App. A managed offering would shift trust
  boundaries and is out of scope.

Any new outbound network call introduced in a v1.x change MUST be added to
this document in the same PR.
