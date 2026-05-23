/**
 * Auto-approval heuristic for dynamic tool calls (symphony #9, G5.G.6).
 *
 * Many tool calls during agent runs are cheap and obviously safe:
 * `Read`, `Glob`, `Grep`, `ls`, `pwd`, `git status`. Prompting the user
 * for each one is noise that trains them to click "allow" reflexively
 * (the worst possible muscle memory). This classifier identifies the
 * narrow set of "definitely safe" calls and approves them silently;
 * everything else falls through to the normal permission prompt path.
 *
 * Default-deny: if we cannot positively confirm a call is in the safe
 * subset, we return `prompt`. There is NO heuristic for "probably ok"
 * — the cost of a false positive is too high (data loss, network
 * egress with secrets, unintended writes).
 *
 * Compound bash → never auto-approve (INV-15 protection). Even if every
 * leg is in the safe-list, granting `allow` would bypass the scope-clamp
 * in `permissionService.check` that restricts compound bash to
 * scope=["once"]. We push to `prompt` so the user can confirm and
 * scope-clamp is applied. Detection uses the canonical `splitCompound`
 * helper (handles `&&`, `||`, `;`, `|`, `&`, `$()`, backticks, `<()`,
 * newlines, and quoting) — never a literal regex, which would miss
 * substitution and quoted-string edge cases.
 */
import { splitCompound } from "./bashCompoundAnalyzer";

export interface ToolCall {
	/** Tool name, e.g. "Read", "Bash", "Edit". */
	tool: string;
	/** Tool input. Shape is per-tool; we only inspect what we recognize. */
	input?: Record<string, unknown>;
}

export interface AutoApprovalDecision {
	decision: "allow" | "prompt" | "deny";
	reason: string;
}

// Tools that NEVER mutate state and NEVER egress network.
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
	"Read",
	"Glob",
	"Grep",
	"LS",
	"NotebookRead",
]);

// First-word commands that are safe by themselves with any arg combination.
// Anything not on this list defaults to prompt.
const SAFE_BASH_COMMANDS: ReadonlySet<string> = new Set([
	"ls",
	"pwd",
	"cd",
	"echo",
	"cat",
	"head",
	"tail",
	"wc",
	"file",
	"stat",
	"which",
	"whoami",
	"hostname",
	"uname",
	"date",
	"env",
	"true",
	"false",
]);

// `git` is allowed only with read-only subcommands.
const SAFE_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
	"status",
	"log",
	"diff",
	"show",
	"branch",
	"remote",
	"config",
	"rev-parse",
	"ls-files",
	"ls-tree",
	"blame",
	"describe",
	"reflog",
	"stash",
	"tag",
	"shortlog",
	"name-rev",
	"cat-file",
]);

// Destructive / remote-mutating tokens that ALWAYS push to prompt.
const HARD_DENY_TOKENS = [
	"rm",
	"sudo",
	"dd",
	"mkfs",
	"reboot",
	"shutdown",
	"halt",
	"poweroff",
	"chmod",
	"chown",
	"mv",
	"cp",
	"curl",
	"wget",
	"nc",
	"ncat",
	"telnet",
	"ssh",
	"scp",
	"rsync",
];

function classifyBashLeg(cmd: string): AutoApprovalDecision {
	const tokens = cmd.trim().split(/\s+/);
	if (tokens.length === 0 || tokens[0] === "") {
		return { decision: "prompt", reason: "empty command, not auto-approvable" };
	}
	const head = tokens[0];

	if (HARD_DENY_TOKENS.includes(head)) {
		return {
			decision: "prompt",
			reason: `command starts with "${head}", a destructive or network-mutating token`,
		};
	}

	if (SAFE_BASH_COMMANDS.has(head)) {
		return { decision: "allow", reason: `"${head}" is read-only / inert` };
	}

	if (head === "git") {
		const sub = tokens[1] ?? "";
		if (SAFE_GIT_SUBCOMMANDS.has(sub)) {
			return { decision: "allow", reason: `git ${sub} is read-only` };
		}
		return {
			decision: "prompt",
			reason: `git subcommand "${sub}" is not in the safe-list`,
		};
	}

	return {
		decision: "prompt",
		reason: `command "${head}" is not in the safe-list (default-deny)`,
	};
}

/**
 * Classify a tool call for auto-approval. See module header for the
 * default-deny posture and the composition rule.
 */
export function classifyToolForAutoApproval(call: ToolCall): AutoApprovalDecision {
	if (READ_ONLY_TOOLS.has(call.tool)) {
		return { decision: "allow", reason: `${call.tool} is a read-only tool` };
	}

	if (call.tool === "Bash") {
		const command = String(call.input?.command ?? "").trim();
		if (!command) {
			return { decision: "prompt", reason: "Bash call has no command" };
		}
		// INV-15: compound bash NEVER auto-approves, even if every leg is in
		// the safe-list. Auto-approval returns `allow` which short-circuits
		// the scope-clamp in `permissionService.check`; falling through to
		// `prompt` lets the clamp restrict scopes to ["once"].
		const legs = splitCompound(command);
		if (legs.length > 1) {
			return {
				decision: "prompt",
				reason: "compound bash skipped from auto-approval (INV-15 scope-clamp)",
			};
		}
		if (legs.length === 0) {
			return { decision: "prompt", reason: "Bash call is empty after splitting" };
		}
		const decision = classifyBashLeg(legs[0]);
		if (decision.decision !== "allow") {
			return decision;
		}
		return decision;
	}

	// Anything mutating or unknown: prompt.
	return {
		decision: "prompt",
		reason: `tool "${call.tool}" is mutating or unknown`,
	};
}
