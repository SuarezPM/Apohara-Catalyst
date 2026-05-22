# Apohara Principles

Six commitments we made to ourselves when building this. They explain why the code looks the way it does — and what we won't change later for convenience.

## 1. Your credentials, your machine

Apohara never holds your provider API keys. The three CLI drivers (`claude-code-cli`, `codex-cli`, `opencode-go`) authenticate against your existing subscriptions over stdio. No OAuth flow, no cloud-side token vault, no "improved" key management we'd later have to defend.

If you delete Apohara tomorrow, no upstream service has anything of yours to expire.

## 2. Replay or it didn't happen

Every meaningful event — task dispatch, provider request, tool call, verdict, ledger commit — is appended to a SHA-256 chained event log. `apohara replay --verify` recomputes the chain end-to-end. The same orchestration, given the same inputs and the same provider responses, produces the same outputs. Bug reports that include `replay.jsonl` are reproducible bug reports; the rest are guesses.

## 3. The judge / critic / invariants gate (INV-15) is not optional

Before any code Apohara wrote reaches a PR, three independent checks must agree:
1. A **judge** model accepts the work against the spec.
2. A **critic** model finds no blocking concerns.
3. The **invariant suite** (tests + schema + permission lattice) is green.

A 2-of-3 majority does not ship. Loosening this gate is not a v1.x change; it's a fork.

## 4. The blast radius of any agent is finite

Every spawned agent runs in:
- A git worktree it cannot escape (§3.1 naming + symlink-escape detection).
- A sandbox process tree with seccomp-bpf + Linux namespaces.
- An environment scrubbed of host secrets (§0.4 env sanitization).
- A permission lattice where `deny` always wins and bash compounds (`&&`, `||`, `;`) can never be granted `always` scope.

When something goes wrong — and something always goes wrong — the damage stops at the worktree boundary.

## 5. Three providers. No more, no fewer.

Apohara wraps `claude-code-cli`, `codex-cli`, and `opencode-go`. That's the active roster. New providers, no matter how exciting, are LEGACY behind `APOHARA_LEGACY_PROVIDERS=1` until we can characterize their behavior end-to-end against the JCR gate. A fourth "official" provider is a major-version event, not a config toggle.

## 6. Local-first, not local-only

Apohara runs on your machine. The desktop UI is Tauri (no Electron, no headless browser tab). The orchestration DB is bun:sqlite. The ledger is JSONL on disk. The indexer is on-device tree-sitter + Nomic BERT.

GitHub bridge is opt-in and poll-only in v1.0 (`apohara verify-setup` does not require it). Cloud is a place you can choose to publish to — not a place your work has to live.

---

These principles drove every "no" we said during v1.0. They will drive every "no" we say during v1.x.