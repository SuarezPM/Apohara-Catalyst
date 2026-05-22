/**
 * Update checker — adapted from orca's `electron-updater` flow
 * (`reference/orca/src/main/updater.ts:1-882`) for Apohara's
 * bun-based runtime (we don't have Electron).
 *
 * Responsibilities:
 *   - Compare the installed semver against `latest` (and optionally
 *     `prerelease`) from the GitHub releases API.
 *   - Return a structured `UpdateCheckResult` the UI / CLI can render.
 *   - Do NOT download or install — Apohara's packaging story lands
 *     in Stage 8. This module's job is "tell the user a new release
 *     exists" with the changelog URL.
 *
 * The multi-stage retry ladder (orca §11):
 *   1. Daily check on app boot (default 24 h interval).
 *   2. On transient failure (network blip): retry in 1 h.
 *   3. After update is installed: nudge poll every 30 min so the
 *      release notes show fresh data when the user opens the UI.
 *
 * Prerelease opt-in via either:
 *   - `APOHARA_INCLUDE_PRERELEASE=1` env var, OR
 *   - `includePrerelease: true` on the call.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const GITHUB_API = "https://api.github.com";
const DEFAULT_OWNER = "SuarezPM";
const DEFAULT_REPO = "apohara";

export interface UpdateCheckOptions {
	owner?: string;
	repo?: string;
	includePrerelease?: boolean;
	/** Override the current version (useful for tests). When omitted
	 * we read `package.json` from the repo root or `APOHARA_VERSION`
	 * env. */
	currentVersion?: string;
	/** Override the fetch impl (test seam). */
	fetch?: typeof fetch;
}

export interface UpdateCheckResult {
	currentVersion: string;
	latestVersion: string | null;
	updateAvailable: boolean;
	prerelease: boolean;
	releaseUrl: string | null;
	publishedAt: string | null;
	body: string | null;
	error?: string;
}

interface GhRelease {
	tag_name: string;
	name?: string;
	prerelease: boolean;
	draft: boolean;
	html_url: string;
	published_at: string;
	body?: string;
}

/**
 * Compare two semver strings. Returns -1 if a < b, 1 if a > b, 0 if
 * equal. Supports `X.Y.Z` and pre-release suffixes per the canonical
 * algorithm — pre-releases sort before their associated release
 * (1.0.0-rc.1 < 1.0.0). Build metadata (`+sha`) is ignored.
 */
export function semverCompare(a: string, b: string): number {
	const norm = (v: string) => v.replace(/^v/, "").split("+")[0];
	const splitMain = (v: string): { core: number[]; pre: string[] } => {
		const [coreStr, ...preParts] = norm(v).split("-");
		const core = coreStr.split(".").map((p) => Number.parseInt(p, 10) || 0);
		const pre = preParts.length > 0 ? preParts.join("-").split(".") : [];
		return { core, pre };
	};
	const A = splitMain(a);
	const B = splitMain(b);
	for (let i = 0; i < Math.max(A.core.length, B.core.length); i++) {
		const av = A.core[i] ?? 0;
		const bv = B.core[i] ?? 0;
		if (av < bv) return -1;
		if (av > bv) return 1;
	}
	if (A.pre.length === 0 && B.pre.length > 0) return 1;
	if (A.pre.length > 0 && B.pre.length === 0) return -1;
	for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i++) {
		const ap = A.pre[i] ?? "";
		const bp = B.pre[i] ?? "";
		if (ap === bp) continue;
		const an = Number.parseInt(ap, 10);
		const bn = Number.parseInt(bp, 10);
		if (!Number.isNaN(an) && !Number.isNaN(bn)) {
			if (an < bn) return -1;
			if (an > bn) return 1;
		} else {
			if (ap < bp) return -1;
			if (ap > bp) return 1;
		}
	}
	return 0;
}

async function readCurrentVersion(): Promise<string> {
	if (process.env.APOHARA_VERSION) return process.env.APOHARA_VERSION;
	// Walk up to find package.json — same heuristic the bun server uses.
	let dir = process.cwd();
	for (let i = 0; i < 8; i++) {
		try {
			const body = await readFile(join(dir, "package.json"), "utf-8");
			const pkg = JSON.parse(body) as { version?: string };
			if (pkg.version) return pkg.version;
		} catch {
			/* not here */
		}
		const parent = dir.replace(/\/[^/]+$/, "");
		if (parent === dir) break;
		dir = parent;
	}
	return "0.0.0";
}

export async function checkForUpdates(
	opts: UpdateCheckOptions = {},
): Promise<UpdateCheckResult> {
	const owner = opts.owner ?? process.env.APOHARA_RELEASE_OWNER ?? DEFAULT_OWNER;
	const repo = opts.repo ?? process.env.APOHARA_RELEASE_REPO ?? DEFAULT_REPO;
	const includePrerelease =
		opts.includePrerelease ??
		process.env.APOHARA_INCLUDE_PRERELEASE === "1";
	const fetchImpl = opts.fetch ?? fetch;
	const currentVersion =
		opts.currentVersion ?? (await readCurrentVersion());

	const url = `${GITHUB_API}/repos/${owner}/${repo}/releases?per_page=20`;
	let response: Response;
	try {
		response = await fetchImpl(url, {
			headers: {
				Accept: "application/vnd.github+json",
				// GitHub allows 60 anonymous requests/h per IP — plenty for
				// a once-a-day check across users.
				"User-Agent": "apohara-updater",
			},
			signal: AbortSignal.timeout(10_000),
		});
	} catch (err) {
		return {
			currentVersion,
			latestVersion: null,
			updateAvailable: false,
			prerelease: false,
			releaseUrl: null,
			publishedAt: null,
			body: null,
			error: `fetch failed: ${(err as Error).message}`,
		};
	}

	if (!response.ok) {
		return {
			currentVersion,
			latestVersion: null,
			updateAvailable: false,
			prerelease: false,
			releaseUrl: null,
			publishedAt: null,
			body: null,
			error: `GitHub returned HTTP ${response.status}`,
		};
	}

	const releases = (await response.json()) as GhRelease[];
	const candidates = releases.filter((r) => !r.draft).filter((r) => {
		if (r.prerelease && !includePrerelease) return false;
		return true;
	});

	if (candidates.length === 0) {
		return {
			currentVersion,
			latestVersion: null,
			updateAvailable: false,
			prerelease: false,
			releaseUrl: null,
			publishedAt: null,
			body: null,
		};
	}

	// Find the highest tag via semver compare (don't trust the list
	// ordering — GitHub's `releases` endpoint is created-at order, not
	// semver order).
	const best = candidates.reduce((acc, cur) =>
		semverCompare(cur.tag_name, acc.tag_name) > 0 ? cur : acc,
	);

	return {
		currentVersion,
		latestVersion: best.tag_name,
		updateAvailable: semverCompare(best.tag_name, currentVersion) > 0,
		prerelease: best.prerelease,
		releaseUrl: best.html_url,
		publishedAt: best.published_at,
		body: best.body ?? null,
	};
}
