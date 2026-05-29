> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

# G10.A — Cross-Platform Validation Report

Date: 2026-05-23
Branch: feat/apohara-catalyst (Sprint 9 cierre `d20b060`, Sprint 10 in progress)
CI workflow: `.github/workflows/ci.yml` `cross-platform-smoke` job

## Matrix coverage

| OS            | Node | Install via npm pack | apohara doctor | apohara --version | Status |
|---------------|------|----------------------|----------------|-------------------|--------|
| ubuntu-22.04  | 20   | TBD                  | TBD            | TBD               | PENDING |
| ubuntu-22.04  | 22   | TBD                  | TBD            | TBD               | PENDING |
| macos-14      | 20   | TBD                  | TBD            | TBD               | PENDING |
| macos-14      | 22   | TBD                  | TBD            | TBD               | PENDING |
| windows-2022  | 20   | TBD                  | TBD            | TBD               | PENDING |
| windows-2022  | 22   | TBD                  | TBD            | TBD               | PENDING |
| WSL2 (manual) | 20+  | TBD                  | TBD            | TBD               | PENDING |

(Fill in TBD with PASS/FAIL after CI run + manual WSL2 smoke.)

## CI runbook references

- Cross-platform matrix: G10.A.1 (commit `4a051a2`) `.github/workflows/ci.yml` `cross-platform-smoke` job, 3 OS × 2 Node = 6 cells.
- WSL2 manual smoke: G10.A.2 (commit `869c4b4`) `wsl2-runbook.md`.
- macOS notarization: G10.A.3 (commit `7476777`) — N/A for npm distro; Tauri .app deferred to v1.1+.

## Anomalías

(Listar aquí cualquier failure inesperado + mitigación.)

## Decisión para Sprint 11 launch

- PROCEED if all matrix cells PASS + WSL2 manual smoke PASS
- BLOCK if any platform FAILS without documented mitigation

(Pin in Sprint 11 sign-off form.)
