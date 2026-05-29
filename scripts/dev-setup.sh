#!/usr/bin/env bash
# Apohara dev-setup automation.
#
# Verifies a fresh clone can build and run the native (Dioxus) desktop +
# CLI. The project is Rust-native — there is no Node/Bun toolchain, no
# `packages/`, and no `package.json` (the pre-Dioxus TS/React stack was
# removed in the Sprint-23 migration).
#
# Idempotent: safe to re-run. Each step prints "ok" / "skip" / "fix" so
# the operator can read the trail.
#
# Exit codes:
#   0   everything ok (or nothing to do)
#   1   missing required toolchain (cargo, git)
#   2   workspace build failed

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# --- helpers ---------------------------------------------------------
log()  { printf '\033[36m[dev-setup]\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m  ok\033[0m     %s\n' "$*"; }
skip() { printf '\033[33m  skip\033[0m   %s\n' "$*"; }
fail() { printf '\033[31m  fail\033[0m   %s\n' "$*" >&2; }

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "$1 is required but not installed"
    exit 1
  fi
}

# --- 1. toolchain check ---------------------------------------------
log "checking toolchain"
require cargo
require git
ok "cargo $(cargo --version | awk '{print $2}')"
ok "git $(git --version | awk '{print $3}')"

# --- 2. cargo build (workspace-wide, debug) -------------------------
log "verifying Rust workspace builds"
if cargo build --workspace; then
  ok "cargo build --workspace clean"
else
  fail "cargo build --workspace failed — fix the errors above"
  exit 2
fi

# --- 3. ts-rs bindings ----------------------------------------------
# ts-rs emits per-type bindings into crates/<X>/bindings/*.ts (gitignored)
# when each crate's tests run; `generate_types` aggregates them on demand.
# The codegen test exercises the aggregator and asserts deterministic
# output, so running it is the canonical "bindings are healthy" check.
log "checking ts-rs binding codegen"
if cargo test -p apohara-types >/dev/null 2>&1; then
  ok "ts-rs binding codegen deterministic"
else
  skip "ts-rs codegen test failed — run 'cargo test -p apohara-types' for details"
fi

# --- 4. doctor (env diagnostics) ------------------------------------
log "running apohara doctor"
if cargo run --quiet -p apohara -- doctor >/dev/null 2>&1; then
  ok "doctor reports green"
else
  skip "doctor reported warnings — run 'cargo run -p apohara -- doctor' for details"
fi

log "dev-setup complete"
echo
echo "Next steps:"
echo "  • Launch the desktop UI:  cargo run -p apohara-desktop-dioxus"
echo "  • Or the terminal UI:     cargo run -p apohara-tui"
echo "  • Env diagnostics:        cargo run -p apohara -- doctor"
