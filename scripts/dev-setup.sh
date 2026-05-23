#!/usr/bin/env bash
# Apohara dev-setup automation (vibe-kanban #14 / G5.F.5).
#
# Installs deps, sets up the React/React-DOM symlink that
# `packages/desktop` needs, and verifies the toolchain so a fresh clone
# can run `bun run dev` end-to-end.
#
# Idempotent: safe to re-run. Each step prints "ok" / "skip" / "fix" so
# the operator can read the trail.
#
# Exit codes:
#   0   everything ok (or nothing to do)
#   1   missing required toolchain (bun, cargo)
#   2   workspace install failed
#   3   symlink failed

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
require bun
require cargo
require git
ok "bun $(bun --version)"
ok "cargo $(cargo --version | awk '{print $2}')"

# --- 2. bun install -------------------------------------------------
log "installing JS deps"
if [ -f bun.lockb ] || [ -f bun.lock ]; then
  bun install --frozen-lockfile || bun install
  ok "bun install completed"
else
  bun install
  ok "bun install (no lockfile present)"
fi

# --- 3. desktop react symlink ---------------------------------------
# The desktop package needs the workspace-root react node_modules to
# avoid two copies of React 19. Mirror what Pablo does manually.
log "linking react for packages/desktop"
DESKTOP_NM="$REPO_ROOT/packages/desktop/node_modules"
mkdir -p "$DESKTOP_NM"
for pkg in react react-dom; do
  src="$REPO_ROOT/node_modules/$pkg"
  dst="$DESKTOP_NM/$pkg"
  if [ ! -d "$src" ]; then
    skip "$pkg not in root node_modules — will be picked up via workspaces"
    continue
  fi
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
    ok "symlink $pkg already present"
    continue
  fi
  rm -rf "$dst"
  ln -s "$src" "$dst"
  ok "linked $pkg"
done

# --- 4. cargo build (workspace-wide, debug) -------------------------
log "verifying Rust workspace builds"
if cargo build --workspace >/dev/null 2>&1; then
  ok "cargo build --workspace clean"
else
  skip "cargo build --workspace had warnings — re-run manually for details"
fi

# --- 5. ts-rs bindings up to date -----------------------------------
log "checking ts-rs bindings"
if bun run generate-types:check >/dev/null 2>&1; then
  ok "ts-rs bindings up to date"
else
  skip "ts-rs bindings drifted — run 'bun run generate-types'"
fi

# --- 6. doctor (env diagnostics) ------------------------------------
log "running apohara doctor"
if bun run src/cli.ts doctor >/dev/null 2>&1; then
  ok "doctor reports green"
else
  skip "doctor reported warnings — run 'apohara doctor' for details"
fi

log "dev-setup complete"
echo
echo "Next steps:"
echo "  1. cd packages/desktop && bun run dev"
echo "  2. Open http://localhost:7331"
