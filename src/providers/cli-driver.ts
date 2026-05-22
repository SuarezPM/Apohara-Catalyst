/**
 * CLI-driver provider — Gap 2 / multi-AI orchestration via official agent CLIs.
 *
 * The user-facing pitch ("bring your existing subscriptions, no API keys")
 * is implemented here. Each driver spawns an installed agent CLI as a
 * subprocess, hands it the prompt either as a flag or on stdin, captures
 * stdout, and returns the response. Auth lives entirely inside the CLI
 * (whatever it already does for the user is what we use), so there is no
 * TOS-grey scraping path.
 *
 * Three concrete drivers ship today:
 *   - `claude-code-cli` → @anthropic-ai/claude-code (`claude --print`)
 *   - `codex-cli`       → @openai/codex (`codex exec`)
 *   - `gemini-cli`      → @google/gemini-cli (`gemini -p`)
 *
 * Custom drivers can be registered at runtime via the env var
 * `APOHARA_CLI_DRIVERS_CONFIG` (path to a JSON file with extra
 * [`CliDriverConfig`] entries) so users can add new CLIs without
 * touching the source.
 *
 * Output parsing is intentionally lossy: most agent CLIs print extra
 * UI chrome (welcome banners, token counters, exit hints) around the
 * actual response. Each driver may supply a `cleanOutput` callback to
 * strip its known noise. Tokens are not reliably exposed by these
 * CLIs and we surface zero counts rather than guess — the cost meter
 * already handles `total === 0`.
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { sanitizeEnv } from "../core/persistence/envSanitizer";
import type { ProviderId } from "../core/types";
import type { LLMMessage, LLMResponse } from "./router";

/**
 * Per-binary serialization queue. The claude / codex / gemini CLIs all
 * keep local state in `~/.<provider>/` (credentials, history, session
 * locks). Two concurrent invocations of the same binary from the same
 * Bun process contend on those internal locks and the LATER one hangs
 * until the leader exits — the documented "claude-code-cli sometimes
 * times out at 120 s" failure mode. We coalesce by binary name so a
 * second `claude` call waits for the first to finish before starting,
 * never both at once.
 */
const binaryQueues = new Map<string, Promise<unknown>>();
function runSerialized<T>(binary: string, task: () => Promise<T>): Promise<T> {
	const prev = binaryQueues.get(binary) ?? Promise.resolve();
	const next = prev.catch(() => undefined).then(task);
	binaryQueues.set(
		binary,
		next.catch(() => undefined),
	);
	return next;
}

export interface CliDriverConfig {
	/** ProviderId that this driver fulfills (e.g. `"claude-code-cli"`). */
	id: ProviderId;
	/** Display label used in logs + the cost meter. */
	label: string;
	/** Binary name to look up on PATH (e.g. `"claude"`, `"gemini"`). */
	binary: string;
	/** Build the argv that follows the binary name. */
	args: (input: { prompt: string; system?: string }) => string[];
	/**
	 * If true, the prompt is piped to the binary's stdin instead of being
	 * baked into argv. Use this when the CLI expects long prompts that
	 * would overflow ARG_MAX (~128 KB) or contain newlines that shell
	 * tokenization mangles.
	 */
	stdin?: boolean;
	/**
	 * Optional cleanup of the raw stdout — strip banners, ANSI escapes,
	 * trailing "Press Enter to continue" prompts, etc.
	 */
	cleanOutput?: (raw: string) => string;
	/** Default model name reported in the response metadata. */
	defaultModel: string;
	/**
	 * Per-call timeout in ms. Defaults to 120 s; long-running agents
	 * should override.
	 */
	timeoutMs?: number;
}

/**
 * Strip ANSI escape sequences (CSI + simple ESC sequences) so the
 * response text doesn't carry terminal coloring into the ledger.
 */
function stripAnsi(s: string): string {
	// eslint-disable-next-line no-control-regex
	return s
		.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
		.replace(/\x1b\][^\x07]*\x07/g, "");
}

/**
 * Built-in driver configs. Flags are correct as of late-2025/early-2026
 * CLI releases; if upstream changes the surface, override via the
 * APOHARA_CLI_DRIVERS_CONFIG file rather than patching this list.
 */
export const BUILTIN_CLI_DRIVERS: CliDriverConfig[] = [
	{
		id: "claude-code-cli",
		label: "Claude Code (Anthropic CLI)",
		binary: "claude",
		args: ({ prompt, system }) =>
			system
				? ["--print", "--append-system-prompt", system, prompt]
				: ["--print", prompt],
		cleanOutput: (raw) => stripAnsi(raw).trim(),
		defaultModel: "claude-sonnet-4-via-cli",
	},
	{
		id: "codex-cli",
		label: "Codex (OpenAI CLI)",
		binary: "codex",
		// `codex exec <prompt>` is the non-interactive entry point. The
		// system prompt is folded in front because codex-cli doesn't yet
		// take a separate system flag.
		args: ({ prompt, system }) => [
			"exec",
			system ? `[system] ${system}\n\n[user] ${prompt}` : prompt,
		],
		cleanOutput: (raw) => stripAnsi(raw).trim(),
		defaultModel: "gpt-via-codex-cli",
	},
	{
		id: "gemini-cli",
		label: "Gemini CLI (Google)",
		binary: "gemini",
		args: ({ prompt, system }) =>
			system
				? ["-p", `[system] ${system}\n\n[user] ${prompt}`]
				: ["-p", prompt],
		cleanOutput: (raw) => stripAnsi(raw).trim(),
		defaultModel: "gemini-via-cli",
	},
	{
		// opencode is the upstream CLI from sst/opencode (TypeScript/Bun,
		// not Go — the provider id is historical). We invoke its
		// non-interactive `run --format json` mode so stdout is a stream
		// of NDJSON events; `extractTextFromOpencodeNdjson` concatenates
		// every `type:"text"` part into the final assistant content.
		// System prompt is folded in front because `opencode run` does
		// not take a separate system flag.
		id: "opencode-go",
		label: "opencode (multi-vendor CLI)",
		binary: "opencode",
		args: ({ prompt, system }) => [
			"run",
			"--format",
			"json",
			system ? `[system] ${system}\n\n[user] ${prompt}` : prompt,
		],
		cleanOutput: extractTextFromOpencodeNdjson,
		defaultModel: "opencode-via-cli",
	},

	// --- Legacy providers (opt-in via APOHARA_LEGACY_PROVIDERS=1) ---
	// They land in the registry unconditionally so users can route
	// `APOHARA_RUN_PROVIDER=cursor-agent` for testing, but the active
	// roster picker in the UI doesn't surface them unless legacy mode
	// is on (see `active-roster.ts`).

	{
		// `cursor-agent -p <prompt>` runs headless and exits. The
		// pre-trust step in trust-presets.ts must already have written
		// `.workspace-trusted` or the first-launch menu eats the prompt
		// (orca pinned this behavior in PR #926).
		id: "cursor-agent" as ProviderId,
		label: "Cursor Agent",
		binary: "cursor-agent",
		args: ({ prompt, system }) =>
			system
				? ["-p", `[system] ${system}\n\n[user] ${prompt}`]
				: ["-p", prompt],
		cleanOutput: (raw) => stripAnsi(raw).trim(),
		defaultModel: "cursor-agent-via-cli",
	},
	{
		// `copilot --prompt <text>` runs non-interactively. `--prompt`
		// (not `--interactive`) makes it exit after the response — the
		// shape `callCliDriver` needs. Pre-trust closes the trust modal.
		id: "copilot-cli" as ProviderId,
		label: "GitHub Copilot CLI",
		binary: "copilot",
		args: ({ prompt, system }) =>
			system
				? ["--prompt", `[system] ${system}\n\n[user] ${prompt}`]
				: ["--prompt", prompt],
		cleanOutput: (raw) => stripAnsi(raw).trim(),
		defaultModel: "copilot-via-cli",
	},
	{
		// `aider --message <text>` (or `-m`) runs the message
		// non-interactively then exits. `--yes-always` skips the
		// "are you sure?" prompts that otherwise hang our headless
		// run; `--no-fancy-input` disables the interactive line editor.
		id: "aider" as ProviderId,
		label: "Aider",
		binary: "aider",
		args: ({ prompt, system }) => [
			"--yes-always",
			"--no-fancy-input",
			"--message",
			system ? `[system] ${system}\n\n[user] ${prompt}` : prompt,
		],
		cleanOutput: (raw) => stripAnsi(raw).trim(),
		defaultModel: "aider-via-cli",
	},
];

/**
 * Parse opencode's `--format json` NDJSON stream and return the final
 * assistant text. Each stdout line is a JSON object of the shape
 *   { type, timestamp, sessionID, ...data }
 * with `type ∈ {tool_use, step_start, step_finish, text, reasoning}`.
 * We collect `text` events in order and concatenate their `part.text`
 * fields; everything else (tool calls, step transitions, reasoning)
 * is intentionally dropped here — the streaming surface will surface
 * them via the bus event bridge.
 *
 * Lines that don't parse as JSON are also concatenated as-is so that
 * a CLI version drift that drops out of NDJSON mode degrades to plain
 * stdout instead of producing an empty Enhanced block.
 */
export function extractTextFromOpencodeNdjson(raw: string): string {
	const lines = stripAnsi(raw).split(/\r?\n/);
	const out: string[] = [];
	let sawAnyJson = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const ev = JSON.parse(trimmed) as {
				type?: string;
				part?: { text?: string };
			};
			sawAnyJson = true;
			if (ev.type === "text" && typeof ev.part?.text === "string") {
				out.push(ev.part.text);
			}
		} catch {
			// Non-JSON line — only keep when the rest of the stream
			// wasn't NDJSON either (graceful fallback for version drift).
			if (!sawAnyJson) out.push(trimmed);
		}
	}
	return out.join("").trim();
}

/**
 * Resolve the active driver registry — built-ins plus any user-defined
 * entries loaded from `APOHARA_CLI_DRIVERS_CONFIG`. The user config is
 * appended after built-ins, so a custom entry with the same `id` wins.
 */
export async function loadCliDriverRegistry(): Promise<
	Map<ProviderId, CliDriverConfig>
> {
	const reg = new Map<ProviderId, CliDriverConfig>();
	for (const d of BUILTIN_CLI_DRIVERS) reg.set(d.id, d);

	const overridesPath = process.env.APOHARA_CLI_DRIVERS_CONFIG;
	if (overridesPath) {
		try {
			const text = await readFile(overridesPath, "utf-8");
			const parsed = JSON.parse(text) as unknown;
			if (Array.isArray(parsed)) {
				for (const raw of parsed) {
					const cfg = raw as Partial<CliDriverConfig>;
					if (!cfg.id || !cfg.binary || !cfg.label) continue;
					// User-provided `args` arrives as a string template like
					// `["-p","${prompt}"]`; we materialize it into a function
					// here so the per-call substitution is consistent.
					const argsTemplate = (raw as { args?: string[] }).args;
					reg.set(cfg.id as ProviderId, {
						id: cfg.id as ProviderId,
						label: cfg.label,
						binary: cfg.binary,
						defaultModel: cfg.defaultModel ?? `${cfg.id}-via-cli`,
						stdin: cfg.stdin,
						args: ({ prompt, system }) =>
							(argsTemplate ?? ["-p", prompt]).map((tok) =>
								tok
									.replaceAll("${prompt}", prompt)
									.replaceAll("${system}", system ?? ""),
							),
						cleanOutput: (raw) => stripAnsi(raw).trim(),
						timeoutMs: cfg.timeoutMs,
					});
				}
			}
		} catch (e) {
			console.warn(
				`cli-driver: failed to load APOHARA_CLI_DRIVERS_CONFIG=${overridesPath}: ${
					(e as Error).message
				}`,
			);
		}
	}

	return reg;
}

/**
 * Run a CLI-driver provider end-to-end. Caller has already verified the
 * config exists in the registry. Test code may bypass the registry by
 * passing a config built inline.
 */
export async function callCliDriver(
	cfg: CliDriverConfig,
	messages: LLMMessage[],
): Promise<LLMResponse> {
	const system = messages
		.filter((m) => m.role === "system")
		.map((m) => m.content)
		.join("\n\n")
		.trim();
	const userParts = messages
		.filter((m) => m.role !== "system")
		.map((m) => `[${m.role}] ${m.content}`)
		.join("\n\n");

	const prompt = userParts.length > 0 ? userParts : "(empty prompt)";
	const argv = cfg.args({ prompt, system: system || undefined });
	const timeoutMs = cfg.timeoutMs ?? 120_000;

	return runSerialized(cfg.binary, () => runOnce(cfg, prompt, argv, timeoutMs));
}

async function runOnce(
	cfg: CliDriverConfig,
	prompt: string,
	argv: string[],
	timeoutMs: number,
): Promise<LLMResponse> {
	// §0.4: NEVER pass the parent env unsanitized — that would leak API
	// keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.) into the CLI
	// subprocess. The official CLIs read their own auth from
	// `~/.<provider>/` so they don't need the keys; passing them only
	// risks "wrong account billed" (the nimbalyst incident) and credential
	// exposure through process listings or core dumps.
	const env = sanitizeEnv(process.env as Record<string, string | undefined>, {
		allow: ["APOHARA_DRIVEN"],
	});
	env.APOHARA_DRIVEN = "1";

	const child = spawn(cfg.binary, argv, {
		stdio: cfg.stdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
		env,
	});

	if (cfg.stdin && child.stdin) {
		// Slow CLIs that haven't opened stdin yet can EPIPE on a fast
		// write; without a handler the unhandled `error` would crash the
		// bun process. We surface it as a soft warning — the timeout/exit
		// branches will close the call cleanly.
		child.stdin.on("error", (err) => {
			console.warn(
				`cli-driver(${cfg.id}): stdin error: ${(err as Error).message}`,
			);
		});
		child.stdin.write(prompt);
		child.stdin.end();
	}

	let stdout = "";
	let stderr = "";
	const onStdout = (chunk: Buffer) => {
		stdout += chunk.toString("utf-8");
	};
	const onStderr = (chunk: Buffer) => {
		stderr += chunk.toString("utf-8");
	};
	child.stdout?.on("data", onStdout);
	child.stderr?.on("data", onStderr);

	const exitCode: number = await new Promise((resolve, reject) => {
		let settled = false;
		const settle = (action: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.stdout?.off("data", onStdout);
			child.stderr?.off("data", onStderr);
			action();
		};
		const timer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				/* already gone */
			}
			settle(() =>
				reject(
					new Error(
						`${cfg.id}: CLI driver timed out after ${timeoutMs} ms (binary=${cfg.binary})`,
					),
				),
			);
		}, timeoutMs);
		child.on("error", (err) => {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				settle(() =>
					reject(
						new Error(
							`${cfg.id}: binary "${cfg.binary}" not found on PATH. Install the official CLI to enable this provider.`,
						),
					),
				);
			} else {
				settle(() => reject(err));
			}
		});
		child.on("exit", (code) => {
			settle(() => resolve(code ?? -1));
		});
	});

	if (exitCode !== 0) {
		throw new Error(
			`${cfg.id}: CLI driver exited with code ${exitCode}. stderr: ${stderr.trim()}`,
		);
	}

	const content = (cfg.cleanOutput ?? stripAnsi)(stdout);
	// Surface empty-success cases. Some CLIs return exit 0 with no
	// output when their auth/config is broken — without this warning
	// the UI just shows a silent empty Enhanced block and the user has
	// no signal that something went wrong on the provider side.
	if (content.length === 0) {
		console.warn(
			`cli-driver(${cfg.id}): exited 0 with empty stdout — check that the CLI is authenticated and the binary's environment is intact`,
		);
	}
	return {
		content,
		provider: cfg.id,
		model: cfg.defaultModel,
		usage: {
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
		},
	};
}
