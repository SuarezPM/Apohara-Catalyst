/**
 * Binary downloader.
 *
 * For a given `version` + detected platform slug:
 *   1. Build the GitHub release asset URL
 *      `https://github.com/<owner>/<repo>/releases/download/v<version>/apohara-desktop-<slug>.tar.gz`.
 *   2. Fetch + extract into the cache dir (`~/.apohara/bin/<v>/<slug>/`).
 *   3. Verify the binary against the matching `<asset>.sha256` sidecar.
 *   4. `chmod +x` on POSIX.
 *
 * No download happens if the binary is already cached AND its hash
 * still matches the sidecar (idempotent).
 */
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureCacheDir, isBinaryCached, sha256OfFile } from "./cache.js";
import { binaryName, detectPlatformSlug } from "./platform.js";

const DEFAULT_OWNER = "SuarezPM";
const DEFAULT_REPO = "apohara";

export interface DownloadOptions {
	version: string;
	owner?: string;
	repo?: string;
	/** Test seam. */
	fetch?: typeof fetch;
}

export interface DownloadResult {
	cached: boolean;
	binaryPath: string;
	verifiedSha256: string;
}

function releaseAssetUrl(owner: string, repo: string, version: string): string {
	const slug = detectPlatformSlug();
	return `https://github.com/${owner}/${repo}/releases/download/v${version}/apohara-desktop-${slug}`;
}

export async function downloadBinary(
	opts: DownloadOptions,
): Promise<DownloadResult> {
	const owner = opts.owner ?? DEFAULT_OWNER;
	const repo = opts.repo ?? DEFAULT_REPO;
	const fetchImpl = opts.fetch ?? fetch;

	const dir = await ensureCacheDir(opts.version);
	const target = join(dir, binaryName());

	if (isBinaryCached(opts.version)) {
		const sha = await sha256OfFile(target);
		return { cached: true, binaryPath: target, verifiedSha256: sha };
	}

	const binUrl = releaseAssetUrl(owner, repo, opts.version);
	const shaUrl = `${binUrl}.sha256`;

	const [binRes, shaRes] = await Promise.all([
		fetchImpl(binUrl, { redirect: "follow" }),
		fetchImpl(shaUrl, { redirect: "follow" }),
	]);

	if (!binRes.ok) {
		throw new Error(
			`failed to download ${binUrl}: HTTP ${binRes.status}`,
		);
	}
	if (!shaRes.ok) {
		throw new Error(
			`failed to download checksum ${shaUrl}: HTTP ${shaRes.status}`,
		);
	}

	const buf = Buffer.from(await binRes.arrayBuffer());
	const shaBody = (await shaRes.text()).trim().split(/\s+/)[0].toLowerCase();

	await writeFile(target, buf);
	const actual = await sha256OfFile(target);
	if (actual.toLowerCase() !== shaBody) {
		throw new Error(
			`checksum mismatch for ${binUrl}: expected ${shaBody}, got ${actual}`,
		);
	}

	if (process.platform !== "win32") {
		await chmod(target, 0o755);
	}

	return { cached: false, binaryPath: target, verifiedSha256: actual };
}
