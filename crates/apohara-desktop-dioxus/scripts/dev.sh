#!/usr/bin/env bash
# scripts/dev.sh — Dioxus dev server with hot reload (subsecond).
#
# Requires dioxus-cli (`dx`). Install it however suits your env:
#   - Arch / CachyOS: sudo pacman -S dioxus-cli
#   - Cargo (user scope): cargo install dioxus-cli --version 0.7.9 --locked
#
# Once available, `dx serve` watches `src/` + `assets/` (see Dioxus.toml).
# Edits to rsx! components hot-patch via subsecond without a full restart;
# edits to type signatures / new deps trigger a full rebuild.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v dx >/dev/null 2>&1; then
    echo "error: dx not found on PATH" >&2
    echo "install dioxus-cli, then re-run this script." >&2
    exit 1
fi

exec dx serve --platform desktop --hot-reload
