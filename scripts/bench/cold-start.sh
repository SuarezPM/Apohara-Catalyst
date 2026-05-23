#!/usr/bin/env bash
# scripts/bench/cold-start.sh
# Measure apohara CLI cold start (time to print --version).
#
# Usage: ./scripts/bench/cold-start.sh
# Output: /tmp/apohara-cold-start.json + summary on stdout

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="${APOHARA_CLI:-$REPO_ROOT/npx-cli/dist/cli.js}"

if [ ! -f "$CLI" ]; then
  echo "Error: CLI not built. Run 'cd npx-cli && bun run build' first."
  exit 1
fi

if ! command -v hyperfine > /dev/null; then
  echo "Error: hyperfine not installed. Install with 'sudo pacman -S hyperfine' (Arch) or your package manager."
  exit 1
fi

OUT_JSON=/tmp/apohara-cold-start.json
hyperfine \
  --warmup 3 \
  --runs 20 \
  --command-name "apohara --version" \
  --export-json "$OUT_JSON" \
  "node $CLI --version"

if command -v jq > /dev/null; then
  P50_MS=$(jq '.results[0].mean * 1000' "$OUT_JSON")
  P95_MS=$(jq '.results[0].max * 1000' "$OUT_JSON")
  echo ""
  echo "  cold-start p50: ${P50_MS} ms"
  echo "  cold-start max: ${P95_MS} ms"
  echo "  target:         < 500ms (p50)"
fi
