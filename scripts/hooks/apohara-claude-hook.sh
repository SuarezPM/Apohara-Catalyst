#!/bin/bash
# apohara-claude-hook.sh
#
# Auto-installed by Apohara in ~/.claude/hooks/.
# Reads stdin (Claude Code hook payload), POSTs to the apohara-hooks-server
# loopback endpoint, NEVER fails the CLI (always exits 0).
#
# The event "type" is derived from the `hook_event_name` field Claude Code
# passes on stdin (PreToolUse/PostToolUse/Stop/UserPromptSubmit/...), mapped to
# the snake_case discriminants the loopback server expects. The spawn cannot
# set it: the same script handles every event, and only the stdin payload knows
# which one fired.
#
# Env vars injected by Apohara when spawning Claude:
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

# Derive the server's snake_case discriminant from Claude Code's PascalCase
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

# --- PreToolUse claim-guard backstop (US-F2.0c) -----------------------------
# HARD enforcement behind the F2.0b prompt (which is the PRIMARY mitigation):
# block a mesh blade's file write when it holds NO active claim for its task.
# Scope is deliberately narrow so we never disturb normal claude use:
#   * only on PreToolUse,
#   * only on a mesh-managed spawn (APOHARA_TASK_ID set), and
#   * only for write tools (Write/Edit/MultiEdit/NotebookEdit).
# Everything else falls through to `exit 0` exactly as before. The guard binary
# itself fails OPEN (missing binary / not-a-repo / IO error → exit 0): a
# backstop must never strand a blade over its own fault.
if [ "$HOOK_EVENT_NAME" = "PreToolUse" ] && [ -n "${APOHARA_TASK_ID:-}" ]; then
  # Read the tool name from the same stdin payload (jq when available, grep
  # fallback — mirrors the PORT/TOKEN parsing above).
  TOOL_NAME=""
  if command -v jq >/dev/null 2>&1; then
    TOOL_NAME=$(printf '%s' "$PAYLOAD" | jq -r '.tool_name // empty' 2>/dev/null)
  else
    TOOL_NAME=$(printf '%s' "$PAYLOAD" \
      | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' \
      | sed 's/.*"\([^"]*\)"$/\1/')
  fi
  case "$TOOL_NAME" in
    Write|Edit|MultiEdit|NotebookEdit)
      APOHARA_BIN="${APOHARA_BIN:-apohara}"
      # Missing guard binary → fail-open (do NOT block on an absent backstop).
      if command -v "$APOHARA_BIN" >/dev/null 2>&1; then
        # The CLI exits 2 to block (no active claim) or 0 to allow / fail-open.
        # Block ONLY on the explicit 2; any other code falls through to exit 0
        # so an unexpected guard fault never strands the blade (fail-open).
        # Pass the tool name so the guard can also enforce the US-S4 PLAN-phase
        # read-only gate (a PLAN-phase mutation exits 2). Older installed hooks
        # that omit --tool still get the FileWrite gate (the guard defaults to
        # it, since this branch only runs for write tools).
        GUARD_RC=0
        "$APOHARA_BIN" hooks check-claim --tool "$TOOL_NAME" || GUARD_RC=$?
        [ "$GUARD_RC" -eq 2 ] && exit 2
      fi
      ;;
  esac
fi

exit 0