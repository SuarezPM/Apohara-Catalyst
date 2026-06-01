#!/bin/bash
# apohara-claude-hook.sh
#
# Auto-installed by Apohara in ~/.opencode/hooks/.
# Reads stdin (Claude Code hook payload), POSTs to the apohara-hooks-server
# loopback endpoint, NEVER fails the CLI (always exits 0).
#
# The event "type" is derived from the `hook_event_name` field the host CLI
# passes on stdin (PreToolUse/PostToolUse/Stop/UserPromptSubmit/...), mapped to
# the snake_case discriminants the loopback server expects. The spawn cannot
# set it: the same script handles every event, and only the stdin payload knows
# which one fired.
#
# Env vars injected by Apohara when spawning OpenCode:
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

# Derive the server's snake_case discriminant from the PascalCase
# `hook_event_name` (carried on stdin). Falls back to APOHARA_HOOK_TYPE (set by
# other hosts that wire the var) and finally to "unknown".
HOOK_EVENT_NAME=""
if command -v jq >/dev/null 2>&1; then
  HOOK_EVENT_NAME=$(printf '%s' "$PAYLOAD" | jq -r '.hook_event_name // empty' 2>/dev/null)
fi
case "$HOOK_EVENT_NAME" in
  PreToolUse)        EVENT_TYPE="pre_tool_use" ;;
  PostToolUse)       EVENT_TYPE="post_tool_use" ;;
  PostToolUseFailure) EVENT_TYPE="post_tool_use_failure" ;;
  Stop|StopFailure)  EVENT_TYPE="stop" ;;
  UserPromptSubmit)  EVENT_TYPE="user_prompt_submit" ;;
  PermissionRequest) EVENT_TYPE="permission_request" ;;
  *)                 EVENT_TYPE="${APOHARA_HOOK_TYPE:-unknown}" ;;
esac

ENVELOPE=$(cat <<EOF
{
  "type": "${EVENT_TYPE}",
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