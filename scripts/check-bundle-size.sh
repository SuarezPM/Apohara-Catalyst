#!/usr/bin/env bash
# G7.D.4 — Bundle size guard.
#
# Fails CI when either the desktop release binary or the npx-cli
# bundle exceeds its hard budget. We track two artefacts:
#
#   1. target/release/apohara-desktop   ≤ 200 MB
#      Tauri ships an embedded WebView2 / wry chrome on win/linux.
#      We've watched the binary creep ~5 MB every 3 sprints — this
#      gate makes the next 50 MB regression a CI failure instead
#      of a silent npm install timeout.
#
#   2. npx-cli/dist/cli.js              ≤ 500 KB
#      The shim has zero prod deps; the bundle stays small or we
#      accidentally pulled `node_modules/*` into the build.
#
# The script is intentionally artefact-tolerant: if a target file
# is absent we WARN and continue (CI legs that don't build that
# artefact must not trip the gate). Override budgets via env vars
# for emergency green-walks (`BUDGET_DESKTOP_BYTES=...`).
#
# Usage:
#   bash scripts/check-bundle-size.sh [<repo-root>]
#
# Exit codes:
#   0  every present artefact is under budget
#   1  at least one artefact overshot
#   2  bad invocation (missing dependency)

set -euo pipefail

ROOT="${1:-$(pwd)}"

# Budgets in BYTES so the comparison is exact (avoids MB rounding).
BUDGET_DESKTOP_BYTES="${BUDGET_DESKTOP_BYTES:-$((200 * 1024 * 1024))}"
BUDGET_CLI_BYTES="${BUDGET_CLI_BYTES:-$((500 * 1024))}"

# `stat -c %s` is GNU; `stat -f %z` is BSD/macOS. Pick at runtime.
file_size_bytes() {
	local path="$1"
	if stat --version >/dev/null 2>&1; then
		stat -c '%s' "$path"
	else
		stat -f '%z' "$path"
	fi
}

format_bytes() {
	local b="$1"
	if (( b >= 1024 * 1024 )); then
		awk -v b="$b" 'BEGIN { printf "%.2f MB", b/1024/1024 }'
	else
		awk -v b="$b" 'BEGIN { printf "%.2f KB", b/1024 }'
	fi
}

ok=1

check_artifact() {
	local label="$1"
	local path="$2"
	local budget="$3"

	if [[ ! -f "$path" ]]; then
		printf '[bundle-size] SKIP %s (not built: %s)\n' "$label" "$path"
		return
	fi

	local size
	size="$(file_size_bytes "$path")"
	local pretty_size pretty_budget
	pretty_size="$(format_bytes "$size")"
	pretty_budget="$(format_bytes "$budget")"

	if (( size > budget )); then
		printf '[bundle-size] FAIL %s: %s > budget %s (%s)\n' \
			"$label" "$pretty_size" "$pretty_budget" "$path"
		ok=0
	else
		printf '[bundle-size] OK   %s: %s ≤ %s (%s)\n' \
			"$label" "$pretty_size" "$pretty_budget" "$path"
	fi
}

# Resolve the desktop binary. The CI matrix builds each target
# under target/<triple>/release/... — when no triple is set we
# fall back to plain target/release.
desktop_candidates=(
	"$ROOT/target/release/apohara-desktop"
	"$ROOT/target/x86_64-unknown-linux-gnu/release/apohara-desktop"
	"$ROOT/target/x86_64-apple-darwin/release/apohara-desktop"
	"$ROOT/target/aarch64-apple-darwin/release/apohara-desktop"
)
desktop_path=""
for cand in "${desktop_candidates[@]}"; do
	if [[ -f "$cand" ]]; then
		desktop_path="$cand"
		break
	fi
done
if [[ -n "$desktop_path" ]]; then
	check_artifact "apohara-desktop" "$desktop_path" "$BUDGET_DESKTOP_BYTES"
else
	printf '[bundle-size] SKIP apohara-desktop (no release build found under target/*/release)\n'
fi

check_artifact "npx-cli/dist/cli.js" "$ROOT/npx-cli/dist/cli.js" "$BUDGET_CLI_BYTES"

if (( ok == 0 )); then
	printf '[bundle-size] FAIL — at least one artefact exceeded its budget.\n' >&2
	exit 1
fi

printf '[bundle-size] PASS — all present artefacts within budget.\n'
