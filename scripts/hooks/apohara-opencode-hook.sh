#!/bin/bash
# apohara-claude-hook.sh
#
# Auto-installed by Apohara in ~/.opencode/hooks/.
# Reads stdin (Claude Code hook payload), POSTs to the apohara-hooks-server
# loopback endpoint, NEVER fails the CLI (always exits 0).
#
# Env vars injected by Apohara when spawning Claude:
#   APOHARA_HOOK_TYPE         (pre_tool_use|post_tool_use|stop|...)
#   APOHARA_TASK_ID           (optional)
#   APOHARA_WORKTREE_ID       (optional)
#   APOHARA_PANE_KEY          (required for correlation)
#
set -u

ENDPOINT="$HOME/.apohara/sockets/hooks-endpoint.json"
[ -f "$ENDPOINT" ] || exit 0

if command -v jq >/dev/null 2>&1; then
  PORT=$(jq -r .port "$ENDPOINT" 2>/dev/null)
  TOKEN=$(jq -r .token "$ENDPOINT" 2>/dev/null)
else
  PORT=$(grep -o '"port"[[:space:]]*:[[:space:]]*[0-9]*' "$ENDPOINT" | grep -o '[0-9]*$')
  TOKEN=$(grep -o '"token"[[:space:]]*:[[:space:]]*"[^"]*"' "$ENDPOINT" | sed 's/.*"\([^"]*\)"$/\1/')
fi

[ -z "${PORT:-}" ] && exit 0
[ -z "${TOKEN:-}" ] && exit 0

PAYLOAD=$(cat)
[ -z "$PAYLOAD" ] && PAYLOAD="{}"

ENVELOPE=$(cat <<EOF
{
  "type": "${APOHARA_HOOK_TYPE:-unknown}",
  "pane_key": "${APOHARA_PANE_KEY:-}",
  "task_id": "${APOHARA_TASK_ID:-}",
  "worktree_id": "${APOHARA_WORKTREE_ID:-}",
  "payload": $PAYLOAD
}
EOF
)

curl -s --max-time 2 \
  -X POST "http://127.0.0.1:$PORT/event" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$ENVELOPE" >/dev/null 2>&1 || true

exit 0