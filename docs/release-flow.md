> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

# Apohara Release Flow

How Apohara goes from `feat/apohara-v1` to `v1.0.0` on Homebrew and GitHub Releases.

## Stages

### 1. Pre-release (auto)

Triggered when a tag matching `v*.*.*-rc*` is pushed:

1. `.github/workflows/desktop-release.yml` runs the cross-OS matrix (`macos-13`, `macos-14`, `ubuntu-22.04`, `windows-2022`).
2. Each platform builds the Tauri bundle + uploads artifacts to a **pre-release** GitHub release.
3. A release note draft is generated from `CHANGELOG.md` (`[Unreleased]` section) plus `git log` since the last tag.
4. The pre-release flag stays `true` until manually promoted.

### 2. Smoke test (manual)

Maintainer downloads the pre-release artifacts and runs:

- `apohara doctor` → all sections OK (or expected-skip for missing CLI providers)
- `apohara verify-setup` → enrolls and approves LOCAL-SETUP-001 end-to-end
- `bun test tests/integration/` → 0 failures (matches CI)
- ContextForge sibling: `pytest tests/ -q` → 310 passed (if installed)

If any of the above fails: delete the pre-release, fix on `feat/apohara-v1`, push a new `v*.*.*-rcN+1` tag.

### 3. Promote to stable (manual)

When the pre-release is green:

1. Edit the GitHub Release in the UI → **uncheck "This is a pre-release"** → publish.
2. Push the canonical tag (no `-rc` suffix): `git tag v1.0.0 && git push --tags`.
3. The `release.yml` workflow promotes the bundles to a stable release.

### 4. Homebrew formula update

After the stable release is up:

1. Compute the tarball SHA256: `curl -sL https://github.com/SuarezPM/Apohara/archive/refs/tags/v1.0.0.tar.gz | sha256sum`.
2. Update `packaging/homebrew/apohara.rb` — replace `REPLACE_AT_RELEASE_TIME_WITH_TARBALL_SHA256` with the real digest.
3. Submit a PR to `homebrew-core` (or the project's `homebrew-tap`).

### 5. Install script

The `install.sh` and `install.ps1` scripts auto-resolve to the latest stable tag via the GitHub Releases API. No manual update needed unless the asset naming scheme changes.

### 6. Announcement (manual)

- Post on the project's preferred channels.
- Mention CHANGELOG.md highlights, especially the v1.0 invariants (INV-15 JCR gate, SHA-256 ledger, 3 sanctioned providers).
- Link the PRINCIPLES.md manifesto as the "what we won't compromise on" reference.

## Rollback

A stable release that breaks something:

1. Mark the GitHub Release as **pre-release** again (do NOT delete it — links from blog posts still need to resolve).
2. Push the previous stable tag's bundle as the new latest, or push a `v1.0.1` with the fix.
3. Update the Homebrew formula to pin the previous version: `version "1.0.0"` → `version "0.9.0"`.

Apohara never auto-rollbacks. Every step is explicit and audited via the ledger.