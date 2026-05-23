# G10.B — Security Audit Report

Date: 2026-05-23 (Sprint 10 execution)
Branch: feat/apohara-catalyst (Sprint 9 cierre `d20b060`)

## cargo audit

Tooling: `cargo-audit 0.22.1` against advisory-db (1098 advisories loaded). Scanned 797 crate dependencies in `Cargo.lock`.

Result: `error: 2 vulnerabilities found! warning: 17 allowed warnings found`.

### Vulnerabilities (2)

Both entries are the same advisory, surfaced once per affected `rsa` version pulled in by the SSH server crate:

| ID | Severity | Crate | Version | Title | Fix |
|----|----------|-------|---------|-------|-----|
| RUSTSEC-2023-0071 | 5.9 (medium) | `rsa` | 0.9.10 | Marvin Attack: potential key recovery through timing sidechannels | No fixed upgrade available |
| RUSTSEC-2023-0071 | 5.9 (medium) | `rsa` | 0.10.0-rc.18 | Marvin Attack: potential key recovery through timing sidechannels | No fixed upgrade available |

Dependency path: `apohara-ssh-server -> russh / russh-keys -> rsa`.

### Allowed warnings (17, all unmaintained / unsound)

All transitively introduced by Tauri/`wry`/`webkit2gtk` (GTK3 ecosystem) or `tauri-utils -> urlpattern -> unic-*`:

- RUSTSEC-2024-0411 / 0412 / 0413 / 0414 / 0415 / 0416 / 0417 / 0418 / 0419 / 0420 — gtk-rs GTK3 bindings unmaintained (`atk`, `atk-sys`, `gdk`, `gdk-sys`, `gdkx11`, `gdkx11-sys`, `gdkwayland-sys`, `gtk`, `gtk-sys`, `gtk3-macros`).
- RUSTSEC-2024-0370 — `proc-macro-error 1.0.4` unmaintained (via `gtk3-macros` and `glib-macros`).
- RUSTSEC-2025-0075 / 0080 / 0081 / 0098 / 0100 — `unic-char-range`, `unic-common`, `unic-char-property`, `unic-ucd-version`, `unic-ucd-ident` unmaintained (via `urlpattern -> tauri-utils`).
- RUSTSEC-2024-0429 — `glib 0.18.5` unsoundness in `Iterator`/`DoubleEndedIterator` for `VariantStrIter` (transitive via Tauri/GTK3).

## bun audit

```
bun audit v1.3.14-canary.1 (0d9b296a)
No vulnerabilities found
```

## npm audit (npx-cli production deps)

After generating `package-lock.json` with `npm i --package-lock-only`:

```
up to date, audited 1 package in 190ms
found 0 vulnerabilities
```

`npx-cli` only declares a single runtime dependency surface — clean.

## Triage

Critical / High count: **0**.
Medium count: **1 advisory** (RUSTSEC-2023-0071, double-counted across two `rsa` versions).
Unmaintained / unsound warnings: 17 (all transitive via Tauri/GTK3).

| Advisory | Severity | Affected | Decision | Justification |
|---|---|---|---|---|
| RUSTSEC-2023-0071 (rsa 0.9.10, 0.10.0-rc.18) | Medium (5.9) | `apohara-ssh-server` via russh/russh-keys | **ACCEPT** | No upstream fix exists. The Marvin Attack requires the attacker to mount an adaptive chosen-ciphertext timing side-channel against an RSA private-key holder; Apohara's SSH server is used for **local-only** orchestrator transports (loopback / Unix-socket equivalents), never exposed publicly. Mitigation: SSH server must remain bound to loopback in the desktop config (re-verify at G10.C). Re-evaluate when `russh` upgrades past the `rsa` family that ships a constant-time fix. |
| RUSTSEC-2024-0411..0420, -0370 (GTK3 family + proc-macro-error) | Unmaintained warnings | `tauri 2.11.1` → `wry`/`webkit2gtk`/`gtk 0.18.2` | **ACCEPT (upstream)** | Tauri 2.11 still ships the GTK3 backend on Linux; the migration to GTK4 is tracked upstream. No alternative without forking Tauri. Re-check after a Tauri minor bump in v1.1. |
| RUSTSEC-2025-0075/0080/0081/0098/0100 (unic-*) | Unmaintained warnings | `tauri-utils 2.9.1` → `urlpattern` → `unic-ucd-ident` | **ACCEPT (upstream)** | Bundled by Tauri's URL pattern matching; replacement requires upstream change in `urlpattern`. No exploitable behaviour, pure maintenance signal. |
| RUSTSEC-2024-0429 (glib 0.18.5 unsoundness) | Unsound warning | `glib 0.18.5` via Tauri/GTK3 | **ACCEPT** | The unsoundness is in `VariantStrIter`, which Apohara does not invoke. Will be eliminated when Tauri's GTK3 layer is replaced. |

No advisory requires a code change in this sprint. All medium/unmaintained items are gated on upstream (Tauri, russh) and tracked here for re-evaluation at the next dependency-bump sweep.

## Sandbox boundary verification

| Layer | Test file / crate | Result |
|---|---|---|
| §0.4 sanitizeEnv | `tests/core/persistence/envSanitizer.test.ts` | **11 pass / 0 fail** (36 expects) |
| §0.8 atomic writes | `tests/core/persistence/atomicWrite.test.ts` | **4 pass / 0 fail** (5 expects) |
| Path safety | `crates/apohara-pathsafety` (lib) | **2 pass / 0 fail / 0 ignored** |
| Sandbox seccomp | `crates/apohara-sandbox` (lib) | **22 pass / 0 fail / 0 ignored** (note: 2 e2e tests live in the e2e harness, ignored on hardened kernels per spec) |

All boundary layers green.

## Conclusión

**PROCEED.**

Zero Critical / Zero High vulnerabilities across the Rust, Bun, and npm dependency trees. The single Medium advisory (RUSTSEC-2023-0071, Marvin Attack on `rsa`) is **accepted** because (1) there is no upstream fix, (2) Apohara's SSH server is loopback-only, and (3) the attacker model required (adaptive chosen-ciphertext timing side-channel against a network-exposed RSA key holder) does not apply. All other warnings are unmaintained-crate signals inherited from Tauri's GTK3 backend and are tracked for re-evaluation at the next Tauri bump. Sandbox boundary tests (envSanitizer, atomicWrite, pathsafety, sandbox) are 100% green (39 tests). Cleared for the rest of the Sprint 10 G10 pre-release gate.
