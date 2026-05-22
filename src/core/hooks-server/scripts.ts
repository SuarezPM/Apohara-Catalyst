/**
 * Per-agent hook script templates.
 *
 * Each CLI agent (claude-code-cli, codex-cli, opencode-go, …) exposes
 * a hook script entry point that fires on PreToolUse / PostToolUse /
 * Stop / etc. We install a thin POSIX shell script per agent that:
 *
 *   1. Reads `~/.apohara/agent-hooks/endpoint.json` for `{port,token}`.
 *   2. Reads the agent-specific hook payload from stdin / env (each
 *      CLI passes a slightly different shape).
 *   3. Translates to Apohara's canonical `HookEvent` envelope.
 *   4. `curl`s the event to `http://127.0.0.1:<port>/event` with the
 *      bearer token.
 *
 * The scripts are intentionally small and POSIX-only — they ship as
 * strings here so the installer (`registry.ts`) writes them with the
 * right permissions atomically.
 *
 * The script reads the endpoint file at every invocation (rather than
 * baking the port at install time) so a server restart picks a new
 * port without re-running `apohara hooks install`.
 */

const ENDPOINT_PATH = "$HOME/.apohara/agent-hooks/endpoint.json";

/** Shared shell preamble: load endpoint file, build curl base. */
const PREAMBLE = `#!/usr/bin/env bash
# Apohara hook script — POSTs CLI hook events to the local hooks
# server. Installed by \`apohara hooks install <agent>\`. Safe to
# regenerate; this file is not user-edited.
set -u
ENDPOINT_FILE="${ENDPOINT_PATH}"
if [ ! -f "$ENDPOINT_FILE" ]; then
	# No endpoint published — Apohara isn't running. Exit 0 so the
	# agent's normal control flow isn't disrupted.
	exit 0
fi
HOOK_PORT=$(awk -F'[":, }]+' '/"port"/ {print $3; exit}' "$ENDPOINT_FILE")
HOOK_TOKEN=$(awk -F'[":, }]+' '/"token"/ {print $3; exit}' "$ENDPOINT_FILE")
if [ -z "$HOOK_PORT" ] || [ -z "$HOOK_TOKEN" ]; then
	exit 0
fi
HOOK_URL="http://127.0.0.1:$HOOK_PORT/event"
`;

/** Claude Code hook script — receives the event JSON on stdin. */
export const CLAUDE_HOOK_SCRIPT = `${PREAMBLE}
# Claude Code pipes its hook event JSON on stdin.
PAYLOAD=$(cat)
[ -z "$PAYLOAD" ] && exit 0
# The payload already carries a \`hook_event_name\` field. We pass it
# through verbatim under \`type\` so the apohara hooks server can route
# without re-parsing.
EVENT_TYPE=$(printf '%s' "$PAYLOAD" | awk -F'"' '/"hook_event_name"/ {print $4; exit}')
[ -z "$EVENT_TYPE" ] && EVENT_TYPE="unknown"
BODY=$(printf '{"type":"%s","payload":%s,"timestamp":%s}' \\
	"$EVENT_TYPE" "$PAYLOAD" "$(date +%s)")
curl -fsS -X POST "$HOOK_URL" \\
	-H "Authorization: Bearer $HOOK_TOKEN" \\
	-H "Content-Type: application/json" \\
	--data-binary "$BODY" \\
	--max-time 2 >/dev/null 2>&1 || true
exit 0
`;

/** Codex hook script — receives event JSON on stdin too. */
export const CODEX_HOOK_SCRIPT = `${PREAMBLE}
# Codex CLI pipes the event JSON on stdin (per codex 0.5.x hooks
# protocol). Codex events carry a top-level \`event\` field that we
# pass through as \`type\`.
PAYLOAD=$(cat)
[ -z "$PAYLOAD" ] && exit 0
EVENT_TYPE=$(printf '%s' "$PAYLOAD" | awk -F'"' '/"event"/ {print $4; exit}')
[ -z "$EVENT_TYPE" ] && EVENT_TYPE="unknown"
BODY=$(printf '{"type":"%s","payload":%s,"timestamp":%s}' \\
	"$EVENT_TYPE" "$PAYLOAD" "$(date +%s)")
curl -fsS -X POST "$HOOK_URL" \\
	-H "Authorization: Bearer $HOOK_TOKEN" \\
	-H "Content-Type: application/json" \\
	--data-binary "$BODY" \\
	--max-time 2 >/dev/null 2>&1 || true
exit 0
`;

/** opencode hook script. opencode plugins (TS/JS) can call this from
 * the lifecycle callback. The simplest universal trigger is to spawn
 * this on `tool.execute.before/after` events from the plugin API. */
export const OPENCODE_HOOK_SCRIPT = `${PREAMBLE}
# opencode plugin hook entry point. Plugins set \`OPENCODE_HOOK_EVENT\`
# in the environment and pipe a JSON payload on stdin.
PAYLOAD=$(cat)
EVENT_TYPE="\${OPENCODE_HOOK_EVENT:-unknown}"
[ -z "$PAYLOAD" ] && PAYLOAD='{}'
BODY=$(printf '{"type":"%s","payload":%s,"timestamp":%s}' \\
	"$EVENT_TYPE" "$PAYLOAD" "$(date +%s)")
curl -fsS -X POST "$HOOK_URL" \\
	-H "Authorization: Bearer $HOOK_TOKEN" \\
	-H "Content-Type: application/json" \\
	--data-binary "$BODY" \\
	--max-time 2 >/dev/null 2>&1 || true
exit 0
`;

export interface HookScriptDescriptor {
	provider: string;
	scriptName: string;
	body: string;
	/** Default path where the script is installed. May vary by OS. */
	defaultInstallPath: string;
}

import { homedir } from "node:os";

function home(): string {
	return process.env.HOME ?? homedir();
}

export function getHookScripts(): HookScriptDescriptor[] {
	return [
		{
			provider: "claude-code-cli",
			scriptName: "apohara-claude-hook.sh",
			body: CLAUDE_HOOK_SCRIPT,
			defaultInstallPath: `${home()}/.claude/hooks/apohara-claude-hook.sh`,
		},
		{
			provider: "codex-cli",
			scriptName: "apohara-codex-hook.sh",
			body: CODEX_HOOK_SCRIPT,
			defaultInstallPath: `${home()}/.codex/hooks/apohara-codex-hook.sh`,
		},
		{
			provider: "opencode-go",
			scriptName: "apohara-opencode-hook.sh",
			body: OPENCODE_HOOK_SCRIPT,
			defaultInstallPath: `${home()}/.config/opencode/hooks/apohara-opencode-hook.sh`,
		},
	];
}
