# G10.D — Doctor + verify-setup Coverage Report

Date: 2026-05-23
Branch: feat/apohara-catalyst (Sprint 10 in progress)

## Doctor checks (`apohara doctor`)

After G10.D.1 (commit `9c95f5d`), `apohara doctor` covers 14 sections:

| Section ID                    | Status check | Source |
|-------------------------------|--------------|--------|
| (7 pre-existing sections)     | ✅           | pre-Sprint-10 |
| node                          | Node >= 20   | G10.D.1 |
| git                           | git >= 2.40  | G10.D.1 |
| os                            | OS support tier | G10.D.1 |
| home                          | Writable ~/.apohara/ | G10.D.1 |
| secrets                       | keyring-rs accessible | G10.D.1 |
| disk                          | > 1 GiB free in workspace dir | G10.D.1 |
| optional-clis                 | gh / hyperfine / playwright (warnings only) | G10.D.1 |

## Exit codes

- `0` — all green
- `1` — unexpected error (panic, IO failure)
- `2` — soft warnings (e.g., optional CLI missing) — installable, partial functionality

## verify-setup

(Wired in G10.D.2 — fill in commit SHA + e2e test status when that lands.)

| Path | Status |
|------|--------|
| Mock provider round-trip via --skip-real-providers | TBD (G10.D.2 commit) |
| Real provider smoke (manual, optional) | Pablo runs per-platform during Sprint 11 launch |

## Conclusión

PROCEED — doctor coverage complete for v1.0.0-rc.1.
verify-setup --skip-real-providers wire status updated when G10.D.2 lands.
