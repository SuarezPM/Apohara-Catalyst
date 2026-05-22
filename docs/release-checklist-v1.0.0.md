# Apohara v1.0.0 Release Checklist

Run through this in order. Do NOT push a stable tag until every box is checked.

## Pre-flight (CI + local)

- [ ] `bun test tests/integration/` → 0 failures
- [ ] `bun test tests/unit/` → 0 failures
- [ ] `cargo test -p apohara-types --lib --tests` → 0 failures
- [ ] `cargo test -p apohara-indexer --lib && cargo test -p apohara-indexer --test memory_integration` → 0 failures (NEVER bare `cargo test -p apohara-indexer` — OOM hazard)
- [ ] `cargo test -p apohara-hooks-server --tests` → 0 failures
- [ ] `cargo build --workspace --release` → succeeds (release profile sanity check)
- [ ] `cargo clippy --workspace -- -D warnings` → 0 errors
- [ ] `bun run generate-types:check` → no Rust↔TS drift
- [ ] `apohara doctor` → all sections OK (or expected-skip for missing providers / no DB yet on fresh checkout)
- [ ] `apohara verify-setup` → LOCAL-SETUP-001 enrolls and approves end-to-end

## Spec compliance

- [ ] INV-15 JCR Safety Gate enforced in PR builder + `apohara doctor`
- [ ] Cross-cutting disciplines §0 audit:
  - [ ] §0.1 IPC listeners centralized (no per-component event handlers in Stage 7)
  - [ ] §0.4 env sanitization on every spawn (no provider keys reach subprocesses)
  - [ ] §0.7 ts-rs SSoT — no hand-edits to `packages/apohara-shared/types.ts`
  - [ ] §0.8 atomic writes — `mkstemp + rename` on the endpoint file, ledger writes
  - [ ] §0.14 token accounting uses absolutes (no delta-only paths)
  - [ ] §0.16 providers use enum_dispatch (no `Box<dyn AgentProvider>`)
- [ ] Bash compound guard (§4.6) — `permission_bash_compound` integration test green
- [ ] Sandbox crate compiles + seccomp filter installs (`cargo build -p apohara-sandbox --release`)

## Documentation

- [ ] `README.md` reflects v1.0 capabilities + install command
- [ ] `CHANGELOG.md` v1.0.0 entry is the latest section (no `[Unreleased]` items left)
- [ ] `PRINCIPLES.md` reflects current commitments (no drift from §0 disciplines)
- [ ] `ARCHITECTURE.md` matches the actual module layout (no stale crate names)
- [ ] `docs/release-flow.md` accurately describes the pre-release → stable flow
- [ ] `docs/github-app-setup.md` reflects the actual GitHub App permissions Apohara needs

## Release artifacts

- [ ] Cross-OS matrix in `.github/workflows/desktop-release.yml` covers `macos-13`, `macos-14`, `ubuntu-22.04`, `windows-2022`
- [ ] Pre-release tag `v1.0.0-rc1` pushed, all platforms green
- [ ] Pre-release bundles smoke-tested on at least 2 platforms (macOS + Linux at minimum)
- [ ] `packaging/homebrew/apohara.rb` SHA256 placeholder ready to be filled

## Public-facing

- [ ] github-bridge poll-only smoke test against a real GitHub App in a sandbox repo (manual)
- [ ] Webhook endpoint returns HTTP 501 (not 500 or 200) — verified manually with `curl`
- [ ] PR-builder idempotency: same `attempt_key` → updates same PR (manual replay on a sandbox PR)

## Known limitations explicitly documented

- [ ] CHANGELOG.md "Known limitations" lists: webhook deferred, indexer OOM hazard, ContextForge pytest dependency, sandbox runner SIGSEGV in some envs
- [ ] No silent regressions vs `apohara-context-forge` (310/310 must stay green)

## Sign-off

- [ ] Pablo reviews and signs the CHANGELOG entry
- [ ] Tag pushed: `git tag v1.0.0 && git push --tags`
- [ ] GitHub Release "This is a pre-release" UNCHECKED (promote to stable)
- [ ] Homebrew formula updated with real SHA256
- [ ] Announcement posted

## Post-release

- [ ] Open `[Unreleased]` section in CHANGELOG.md for v1.1
- [ ] File issues for known limitations (webhook v1.1, indexer OOM, sandbox SIGSEGV)
- [ ] Schedule v1.0.1 timebox for emergency fix window (suggest 14 days)