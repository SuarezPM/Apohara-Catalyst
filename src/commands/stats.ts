/**
 * `apohara stats` — print per-role provider rankings from CapabilityStats.
 *
 * M013.5 verify gate: "human-readable table". This command reads the
 * `.apohara/capability-stats.json` store, computes one Thompson-Sampling
 * draw per (provider, role), and prints a tier-1 ASCII table grouped by
 * task type.
 *
 * M018.D (Pattern D) adds a `last_err` column derived from the most recent
 * `fallback_cooldown` event in `.events/run-*.jsonl` per provider. JSON
 * output gains a `lastErrorClass` field on each ranked entry.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import {
	CAPABILITY_MANIFEST,
	type TaskType,
} from "../core/capability-manifest.js";
import { CapabilityStats } from "../core/capability-stats.js";
import type { EventLog, ProviderErrorClass, ProviderId } from "../core/types.js";

const TASK_TYPES: TaskType[] = [
	"research",
	"planning",
	"codegen",
	"debugging",
	"verification",
];

function padRight(s: string, width: number): string {
	return s.length >= width ? s : s + " ".repeat(width - s.length);
}
function padLeft(s: string, width: number): string {
	return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

function formatPct(n: number): string {
	return `${(n * 100).toFixed(1)}%`;
}

/**
 * M018.D — Reads `fallback_cooldown` and `provider_model_error` events from
 * the most recent `.events/run-*.jsonl` and returns a per-provider map of
 * the latest error class. Empty map if no events directory or no run files.
 */
export async function lastErrorClassByProvider(
	eventsDir: string,
): Promise<Map<ProviderId, ProviderErrorClass>> {
	const out = new Map<ProviderId, ProviderErrorClass>();
	let entries: string[];
	try {
		entries = await readdir(eventsDir);
	} catch {
		return out;
	}
	const candidates = entries.filter(
		(n) => n.startsWith("run-") && n.endsWith(".jsonl"),
	);
	if (candidates.length === 0) return out;

	let latest: { path: string; mtimeMs: number } | null = null;
	for (const name of candidates) {
		const full = join(eventsDir, name);
		try {
			const s = await stat(full);
			if (!latest || s.mtimeMs > latest.mtimeMs) {
				latest = { path: full, mtimeMs: s.mtimeMs };
			}
		} catch {
			// Skip unreadable entries.
		}
	}
	if (!latest) return out;

	let text: string;
	try {
		text = await readFile(latest.path, "utf-8");
	} catch {
		return out;
	}

	// Walk lines in order so the last event wins per provider.
	for (const line of text.split("\n")) {
		if (!line) continue;
		let ev: EventLog;
		try {
			ev = JSON.parse(line) as EventLog;
		} catch {
			continue;
		}
		const cls = ev.metadata?.errorClass;
		const prov = ev.metadata?.provider;
		if (cls && prov) out.set(prov, cls);
	}
	return out;
}

async function runStats(opts: {
	role?: string;
	json?: boolean;
	file?: string;
	eventsDir?: string;
}): Promise<void> {
	const stats = new CapabilityStats(opts.file);
	const allEntries = await stats.all();
	const knownProviders: ProviderId[] = CAPABILITY_MANIFEST.map(
		(c) => c.provider,
	);
	const seenProviders = new Set(allEntries.map((e) => e.provider));
	const allProviders: ProviderId[] = [
		...new Set<ProviderId>([...knownProviders, ...seenProviders]),
	];

	const roles: TaskType[] = opts.role ? [opts.role as TaskType] : TASK_TYPES;
	const eventsDir = opts.eventsDir ?? join(process.cwd(), ".events");
	const lastErrByProvider = await lastErrorClassByProvider(eventsDir);

	if (opts.json) {
		const result: Record<
			string,
			{
				provider: ProviderId;
				score: number;
				rate: number;
				n: number;
				lastErrorClass: ProviderErrorClass | null;
			}[]
		> = {};
		for (const role of roles) {
			const ranked = await stats.rank(allProviders, role);
			result[role] = await Promise.all(
				ranked.map(async (r) => {
					const c = await stats.get(r.provider, role);
					return {
						provider: r.provider,
						score: r.score,
						rate: r.rate,
						n: (c?.successes ?? 0) + (c?.failures ?? 0),
						lastErrorClass: lastErrByProvider.get(r.provider) ?? null,
					};
				}),
			);
		}
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	for (const role of roles) {
		const ranked = await stats.rank(allProviders, role);
		console.log(`\n# ${role}`);
		console.log(
			padRight("rank", 5) +
				padRight("provider", 22) +
				padLeft("score", 8) +
				padLeft("succ_rate", 12) +
				padLeft("trials", 8) +
				padLeft("last_err", 16),
		);
		console.log("-".repeat(71));
		let rank = 1;
		for (const r of ranked) {
			const c = await stats.get(r.provider, role);
			const n = (c?.successes ?? 0) + (c?.failures ?? 0);
			const lastErr = lastErrByProvider.get(r.provider) ?? "-";
			console.log(
				padRight(String(rank), 5) +
					padRight(r.provider, 22) +
					padLeft(r.score.toFixed(3), 8) +
					padLeft(formatPct(r.rate), 12) +
					padLeft(String(n), 8) +
					padLeft(lastErr, 16),
			);
			rank += 1;
		}
	}
	if (allEntries.length === 0) {
		console.log(
			"\nNo observations recorded yet — every score is sampled from the prior.",
		);
		console.log(
			"Counts populate once the router starts emitting `provider_outcome` " +
				"events (M013.3, in flight).",
		);
	}
}

export const statsCommand = new Command("stats")
	.description("Print per-role provider rankings via Thompson Sampling")
	.option(
		"-r, --role <role>",
		"limit to a single role (research|planning|codegen|debugging|verification)",
	)
	.option("--json", "emit JSON instead of an ASCII table")
	.option(
		"-f, --file <path>",
		"path to capability-stats.json (default: .apohara/capability-stats.json under cwd)",
	)
	.option(
		"--events-dir <path>",
		"path to .events directory (default: .events under cwd) — used for last_err column",
	)
	.action(
		async (opts: {
			role?: string;
			json?: boolean;
			file?: string;
			eventsDir?: string;
		}) => {
			await runStats(opts);
		},
	);
