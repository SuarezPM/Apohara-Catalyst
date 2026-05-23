/**
 * multica #4 — redact secret-shaped tokens from log lines before
 * writing/emitting. Best-effort regex sweep. Not a substitute for
 * sanitizeEnv (§0.4, which prevents secrets reaching subprocesses in the
 * first place), but defense-in-depth for logs that we still produce locally.
 *
 * The KV pattern catches typical env-var dumps (`*_API_KEY=…`,
 * `*_TOKEN=…`, `*_SECRET=…`) so a stray `console.error(env)` cannot
 * leak the raw value to a log file or transport.
 */

const PATTERNS: RegExp[] = [
	/AKIA[0-9A-Z]{16}/g, // AWS access key
	/sk-ant-[A-Za-z0-9_-]{20,}/g, // Anthropic key
	/sk-[A-Za-z0-9_-]{32,}/g, // OpenAI / generic
	/ghp_[A-Za-z0-9]{36}/g, // GitHub personal token
	/\bxox[abopstr]-[A-Za-z0-9-]+/g, // Slack
];

const KV_PATTERN =
	/([A-Z][A-Z0-9_]*(?:_API_KEY|_TOKEN|_SECRET))=([^\s"]+)/g;

export function redactSecrets(line: string): string {
	let out = line;
	// KV first so the value is masked before the generic patterns run
	// over it — otherwise `KEY=ghp_…` becomes `KEY=[REDACTED]` for the
	// value but the env-style replace would have nothing left to match.
	out = out.replace(KV_PATTERN, "$1=[REDACTED]");
	for (const p of PATTERNS) {
		out = out.replace(p, "[REDACTED]");
	}
	return out;
}
