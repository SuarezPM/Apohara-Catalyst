> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

# Audit: `desktop-release.yml` — v1.0 Release Requirements

**File:** `.github/workflows/desktop-release.yml`
**Date:** 2026-05-22
**Status:** PATCHED — 2 gaps closed

---

## Requirement Checklist

| Requirement | Status | Workflow Line |
|---|---|---|
| **Cross-OS matrix: `macos-13` (x64)** | OK | `runner: macos-13` / `os-name: darwin-x64` (line 32) |
| **Cross-OS matrix: `macos-14` (aarch64)** | OK | `runner: macos-14` / `os-name: darwin-arm64` (line 38) |
| **Cross-OS matrix: `ubuntu-22.04`** | OK | `runner: ubuntu-22.04` / `os-name: linux-x64` (line 44) |
| **Cross-OS matrix: `windows-2022`** | OK | `runner: windows-2022` / `os-name: win-x64` (line 70) |
| **Trigger: tag matching `v*.*.*`** | OK | `tags: ["v*"]` (line 12) |
| **Build artifacts: Tauri bundles per OS** | OK | `artifact-glob` per matrix entry (lines 34–36, 51–52, 57–59, 72–74) |
| **Upload to GitHub release** | OK | `softprops/action-gh-release@v2` (line 120) |
| **Cache: cargo + bun lockfile keyed** | OK | `Swatinem/rust-cache@v2` + `actions/cache@v4` for bun (lines 76–93) |
| **Fail-fast: false** | OK | `fail-fast: false` (line 29) |

---

## Changes Applied

### Gap 1 — macOS x64 missing
**Before:** `macos-latest` was used only for aarch64 (`darwin-arm64`).

**Fix:** Split into two entries:
- `macos-13` → `darwin-x64`
- `macos-14` → `darwin-arm64`

Lines 32–53 (new).

### Gap 2 — OS version pinning too loose
**Before:** `ubuntu-latest` and `windows-latest` — nondeterministic across time.

**Fix:** Pinned to explicit runners:
- `ubuntu-latest` → `ubuntu-22.04`
- `windows-latest` → `windows-2022`

Lines 44, 70.

### Gap 3 — No bun lockfile caching
**Before:** Only `rust-cache` was present.

**Fix:** Added `actions/cache@v4` step keyed on `bun.lockb` hash, restored per `os-name`.

Lines 77–93.

---

## Validation

```bash
$ yq -r '.jobs.build.strategy.matrix.include | length' .github/workflows/desktop-release.yml
4
```

YAML parses; all 4 matrix entries present.