# Troubleshooting Apohara

> First stop: `apohara doctor`. Second stop: this document. Third stop:
> `~/.apohara/replay.jsonl` + an issue with the relevant slice attached.

## Diagnostic checklist (run this first)

```bash
apohara doctor --json | tee doctor.json
```

`apohara doctor` walks `runtime`, `roster`, `policy`, `sandbox`, `ledger`,
`mcp`, and `assigned`. The JSON output is what to attach to any issue you
file — the text output is for humans.

If `--json` exits non-zero, the `ok: false` section names where to look first.

---

## `roster` section reports a missing CLI

```
[roster    ] FAIL missing: claude
```

**Cause.** The provider binary is not on `$PATH` (or your shell hasn't
reloaded `$PATH` since you installed it).

**Fix.**

```bash
# Install whichever is missing
npm install -g @anthropic-ai/claude-code   # claude
npm install -g @openai/codex               # codex
# opencode: download from https://github.com/sst/opencode/releases

# Reload your shell PATH
exec $SHELL -l

# Re-verify
apohara doctor
```

If the binary IS on `$PATH` but `which claude` still says it's missing,
check that `$PATH` in your shell matches what `apohara` sees. Common
culprit: you installed via npm but your `~/.zshenv` exports a stale
`$PATH` that masks `~/.local/bin`.

---

## `runtime` section says rustc missing

```
[runtime   ] FAIL Bun 1.3.x · rustc missing
```

**Cause.** `rustc` is not on `$PATH`. Apohara doesn't need rustc at runtime
for prebuilt binaries, but `doctor` checks it because the dev workflow
(`cargo build --workspace`) requires it.

**Fix.**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
apohara doctor
```

If you're running the published `apohara` binary and not building from
source, you can suppress the section:

```bash
apohara doctor --skip-runtime
```

---

## Daemon does not start (`apohara plan` hangs)

**Symptoms.** `apohara plan ...` prints nothing for > 30 s, the UI shows
"Connecting to daemon..." indefinitely, no entries land in
`~/.apohara/orchestration.db`.

**Diagnosis.**

```bash
# Is the daemon process alive?
pgrep -af apohara-daemon

# What does the daemon log say?
tail -n 50 ~/.apohara/logs/daemon.log

# Is the local socket present?
ls -l ~/.apohara/run/
```

**Common causes + fixes.**

1. **Stale socket from a previous run.** `rm ~/.apohara/run/daemon.sock` and
   restart the daemon.
2. **Port collision on `APOHARA_DESKTOP_PORT`.** Set a different port
   (`APOHARA_DESKTOP_PORT=7341 apohara plan ...`).
3. **The daemon binary is not on `$PATH`.** Use `apohara doctor` to confirm;
   reinstall via the one-liner installer if so.
4. **WSL-specific.** File watching on a Windows drive (`/mnt/c/...`) is slow
   and unreliable under WSL. Move the checkout to the WSL filesystem
   (`~/apohara/`) and rerun.

---

## Hook events return HTTP 401

**Symptoms.** Provider CLIs spawn, work happens, but `hooks-server` logs
401 entries and the UI shows zero events.

**Cause.** The MCP endpoint file (`~/.apohara/mcp/endpoints.json`) holds a
random 32-char hex token that's rotated on every bootstrap. If a CLI was
launched against a previous bootstrap's token, it now hits a stale endpoint.

**Fix.**

```bash
# Tear down the stale bootstrap
rm ~/.apohara/mcp/endpoints.json

# Rerun verify-setup — it re-bootstraps + re-injects tokens into each CLI's MCP config
apohara verify-setup
```

If 401s persist, check the per-provider MCP config (`~/.claude/claude_desktop_config.json`,
`~/.codex/mcp.json`, `~/.config/opencode/config.json`) — the `endpoint` and
`bearer` fields must match the latest `~/.apohara/mcp/endpoints.json`.

---

## `policy` section reports REJECTED

```
[policy    ] FAIL Strict REJECTED: bash compound `rm -rf && exit` denies always-scope
```

**Cause.** Your `.apohara.json` runner policy combined with the workspace
state asks for an enforcement that the plan compiler refuses (typically:
`always` scope on a compound bash that `compileRunnerExecutionPlan` knows
to reject).

**Fix.**

1. Open `.apohara.json` in the workspace where you ran `apohara doctor`.
2. Find the `runnerPolicy` block.
3. Either downgrade the preset (`Strict` → `Balanced`) or remove the
   offending allow-list entry. The doctor `summary` field names the
   specific enforcement area.
4. Rerun `apohara doctor` to verify.

If you intentionally want `always` scope on a compound command, write a
custom preset (the `Custom` preset is gated; talk to a maintainer before
shipping one).

---

## `cargo test -p apohara-indexer` (no longer an OOM hazard)

**Background.** Older docs warned that `cargo test -p apohara-indexer` would
OOM a 16 GB host because each test binary loaded a ~400 MB Nomic BERT model.
That model is gone. The indexer now uses sqlite-vec storage + deterministic
blake3 feature-hashing embeddings — in-process, ~0 RAM, no model download.

**So just run it:**

```bash
cargo test -p apohara-indexer                            # everything, in parallel
cargo test -p apohara-indexer --lib                      # unit tests only
cargo test -p apohara-indexer --test sqlite_vec_storage  # storage contract
cargo test -p apohara-indexer --test persistence_reopen  # reopen survives
```

There is no per-binary serialization rule and no `APOHARA_MOCK_EMBEDDINGS`
flag anymore — both were tied to the deleted model. See
[`crates/apohara-indexer/AGENTS.md`](../crates/apohara-indexer/AGENTS.md).

---

## Provider CLI times out at exactly 120 s

**Symptoms.** Log line: `claude-code-cli: CLI driver timed out after 120000 ms`.
Verdict: stuck task.

**Cause.** Two concurrent `claude` invocations from the same Bun process
contended on `~/.claude/`'s internal locks. The second one blocked until
our 120 s SIGKILL.

**Fix.** This is fixed at the spawn layer — `cli-driver.ts::runSerialized`
queues calls FIFO per binary name. If you see this in v1.0.0+, you've
probably added a new CLI provider that bypasses the queue. Check
`BUILTIN_CLI_DRIVERS` in `src/providers/cli-driver.ts`.

---

## Atomic write tmp files in the worktree

**Symptoms.** Stray `.tmp-XXXXXX` files in `~/.apohara/` or the workspace
under `.apohara/`.

**Cause.** A `mkstemp + rename` write was interrupted (process crash, OOM,
power loss). The rename never happened.

**Fix.** Safe to delete — the persistence layer always retries from the
canonical filename on next read. `find ~/.apohara -name '*.tmp-*' -delete`.

---

## `npx apohara` says SHA-256 mismatch

**Symptoms.** `npx apohara` prints `SHA-256 mismatch: expected X, got Y`
and refuses to run.

**Cause.** The prebuilt binary downloaded from GitHub Releases does not
match the `.sha256` sidecar published alongside it. Either:

1. The download was interrupted (partial file).
2. There's a man-in-the-middle on your network.
3. (Rare) The release was retagged without rebuilding the sidecar.

**Fix.**

```bash
# 1. Force re-download
rm -rf ~/.npm/_npx/<hash>/
npx apohara@<version> --version

# 2. If still mismatching, verify manually
curl -fsSL https://github.com/SuarezPM/Apohara/releases/download/v1.0.0/apohara-desktop-linux-x64
curl -fsSL https://github.com/SuarezPM/Apohara/releases/download/v1.0.0/apohara-desktop-linux-x64.sha256
sha256sum -c apohara-desktop-linux-x64.sha256
```

If the manual download also fails, open an issue and we'll re-publish the
sidecar from the matching build artifact.

---

## github-bridge webhook returns 501

**Cause.** v1.0 ships poll-only. The webhook handler is a stub that
returns `HTTP 501 Not Implemented` on purpose. The two-track delivery
worker lands in v1.1 (§11.2).

**Fix (workaround until v1.1).** Use the GitHub App's "Pull" workflow —
`github-bridge` polls issues every 30 s and reacts to new ones without
needing a webhook receiver. See [`docs/github-app-setup.md`](github-app-setup.md).

---

## Cross-platform `apohara doctor` expectations (G7.E.6)

`apohara doctor` runs on Linux, macOS (Intel + Apple Silicon), and Windows.
Some sections legitimately differ per platform — they're not regressions.

### Linux (Ubuntu 22.04 / 24.04, CachyOS, Fedora)

All seven sections are expected to report `ok: true` on a clean install:

```
[runtime   ] OK   Bun 1.3.13 · Node 20.x · rustc 1.95
[roster    ] OK   claude · codex · opencode all on PATH
[policy    ] OK   Balanced preset compiles cleanly
[sandbox   ] OK   seccomp-bpf + namespaces available
[ledger    ] OK   ~/.apohara/orchestration.db reachable
[mcp       ] OK   endpoint registered, bearer rotated 12m ago
[assigned  ] OK   no orphan tasks (assigned: 0, completed: 0)
```

The `sandbox` section requires kernel 5.10+ with `CONFIG_USER_NS=y`. CachyOS
ships this enabled; Ubuntu 22.04+ enables it via `kernel.unprivileged_userns_clone=1`.

### macOS Intel (macos-13) + Apple Silicon (macos-14)

The `sandbox` section reports `ok: true` with a different summary — macOS
uses `sandbox-exec` (Seatbelt) instead of seccomp:

```
[sandbox   ] OK   sandbox-exec available · profile loaded
```

The `roster` section is identical: install via the same npm/brew paths,
no platform-specific binaries to worry about.

The `runtime` section may report `rustc missing` if you installed via the
prebuilt binary path (npm install -g apohara). That's harmless for end users
— rustc is only required for `cargo build --workspace` (dev workflow). Pass
`--skip-runtime` if you want a clean exit code:

```bash
apohara doctor --skip-runtime
```

### Windows (windows-2022, Windows 11)

The `sandbox` section is the load-bearing difference:

```
[sandbox   ] WARN AppContainer profile available · seccomp N/A on Windows
```

`ok: true` because AppContainer covers the threat model the sandbox cares
about (filesystem + network egress restrictions). The `WARN` is informational
— Windows just doesn't have seccomp; AppContainer is the equivalent.

The `policy` section is identical across platforms — `compileRunnerExecutionPlan`
is platform-agnostic.

Path normalization is the most common Windows-only doctor regression: if
`roster` reports `claude` missing but `where.exe claude` finds it, your
`$PATH` was mutated by Windows Terminal's PowerShell profile after Bun
spawned the doctor process. Reopen the terminal (`exec` doesn't exist on
Windows PowerShell) and re-run `apohara doctor`.

### CI smoke contract

The `cross-platform-smoke` job in `.github/workflows/ci.yml` runs
`apohara doctor --json` on ubuntu-22.04 + macos-13 + macos-14 + windows-2022
on every PR. Any section that transitions `ok: true` → `ok: false` on one OS
but not the others fails the job. The release smoke (`G7.E.6`) is the
backstop — if a Sprint 7 change breaks the doctor on macOS / Windows
specifically, the cross-platform job catches it before the tag lands.

---

## Still stuck?

Open an issue with:

1. `apohara doctor --json` output.
2. The last ~100 lines of `~/.apohara/logs/daemon.log`.
3. The relevant slice of `~/.apohara/replay.jsonl` (one event per line —
   include the task that failed plus the preceding two events).
4. Your OS + Node + Bun + Rust versions.

That's a reproducible bug report. Without those three artifacts, every
fix is a guess.
