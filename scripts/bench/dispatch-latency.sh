#!/usr/bin/env bash
# scripts/bench/dispatch-latency.sh
# Measure end-to-end /api/run dispatch latency via a mock provider.
#
# Usage: ./scripts/bench/dispatch-latency.sh
# Output: /tmp/apohara-dispatch-latency.json + summary on stdout
#
# Note: there is no APOHARA_FAKE_PROVIDER yet; we set
# APOHARA_DISPATCH_DISABLED=1 so the server creates the session ledger
# and writes `session_started` without spawning a real CLI worker. That
# isolates the HTTP+ledger path, which is what we want to measure here.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${APOHARA_DESKTOP_PORT:-7331}"

if ! command -v hyperfine > /dev/null; then
  echo "Error: hyperfine not installed."
  exit 1
fi

# Start desktop server in dispatch-disabled mode (acts as the mock).
echo "Starting desktop server on port $PORT (dispatch disabled)..."
cd "$REPO_ROOT/packages/desktop"
APOHARA_DESKTOP_PORT="$PORT" \
APOHARA_FAKE_PROVIDER=1 \
APOHARA_DISPATCH_DISABLED=1 \
  bun --hot src/server.ts > /tmp/apohara-bench-server.log 2>&1 &
SERVER_PID=$!

# Cleanup hook
cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Wait for the server to come up
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/" > /dev/null 2>&1; then break; fi
  sleep 0.1
done

# Bench
PAYLOAD='{"prompt":"hello","role":"coder"}'
OUT_JSON=/tmp/apohara-dispatch-latency.json
hyperfine \
  --warmup 3 \
  --runs 30 \
  --command-name "POST /api/run" \
  --export-json "$OUT_JSON" \
  "curl -fsS -X POST http://127.0.0.1:$PORT/api/run -H 'Content-Type: application/json' -d '$PAYLOAD' > /dev/null"

if command -v jq > /dev/null; then
  P50_MS=$(jq '.results[0].mean * 1000' "$OUT_JSON")
  MAX_MS=$(jq '.results[0].max * 1000' "$OUT_JSON")
  echo ""
  echo "  dispatch p50: ${P50_MS} ms"
  echo "  dispatch max: ${MAX_MS} ms"
  echo "  target:       < 200ms (p50)"
fi
