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
import type { ProviderId } from "../core/types";
import type { LLMMessage, LLMResponse } from "./router";

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
];

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

	const child = spawn(cfg.binary, argv, {
		stdio: cfg.stdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
		env: { ...process.env, APOHARA_DRIVEN: "1" },
	});

	if (cfg.stdin && child.stdin) {
		child.stdin.write(prompt);
		child.stdin.end();
	}

	let stdout = "";
	let stderr = "";
	child.stdout?.on("data", (chunk) => {
		stdout += chunk.toString("utf-8");
	});
	child.stderr?.on("data", (chunk) => {
		stderr += chunk.toString("utf-8");
	});

	const exitCode: number = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				/* already gone */
			}
			reject(
				new Error(
					`${cfg.id}: CLI driver timed out after ${timeoutMs} ms (binary=${cfg.binary})`,
				),
			);
		}, timeoutMs);
		child.on("error", (err) => {
			clearTimeout(timer);
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				reject(
					new Error(
						`${cfg.id}: binary "${cfg.binary}" not found on PATH. Install the official CLI to enable this provider.`,
					),
				);
			} else {
				reject(err);
			}
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			resolve(code ?? -1);
		});
	});

	if (exitCode !== 0) {
		throw new Error(
			`${cfg.id}: CLI driver exited with code ${exitCode}. stderr: ${stderr.trim()}`,
		);
	}

	const content = (cfg.cleanOutput ?? stripAnsi)(stdout);
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
