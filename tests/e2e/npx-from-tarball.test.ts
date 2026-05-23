/**
 * G7.D.6 — End-to-end smoke for the `npx apohara` shim built from
 * the in-repo source.
 *
 * Why this exists:
 *   The shim is the entry millions of users will hit
 *   (`npx apohara@latest`). If `npm pack` produces a tarball that
 *   `npm install` then refuses, or if the bundled `dist/cli.js`
 *   trips on a missing import the moment the post-install runs,
 *   we want CI to catch it before the tag lands on npm.
 *
 * What it does:
 *   1. Build the shim (`bun run build` in `npx-cli/`).
 *   2. `npm pack` into a temp dir → emit `apohara-<version>.tgz`.
 *   3. `npm install` the tarball into an isolated sandbox (no
 *      transitive prod deps — the shim's package.json lists none).
 *   4. Invoke `node <prefix>/node_modules/apohara/dist/cli.js
 *      --version` and assert the version string matches
 *      `package.json#version`.
 *
 * Why this is an E2E, not a unit test:
 *   - It exercises `npm pack`'s `files` allow-list (regressions
 *     in `package.json#files` silently ship empty tarballs).
 *   - It checks `node` can resolve the bundled ESM output without
 *     hitting any prod dep that's missing from the tarball.
 *   - `--version` short-circuits before binary resolution, so this
 *     stays NETWORK-FREE — the long path (downloadBinary) is
 *     covered by `tests/npx-cli/*.test.ts` with mocks.
 *
 * Skipped when:
 *   - `npm` isn't on PATH (e.g. minimal Rust-only runners).
 *   - `APOHARA_SKIP_NPX_E2E=1` (opt-out for slow VMs).
 *
 * Timeout: 90 s — `npm install --prefix` cold-starts the resolver
 * even with `--no-audit --no-fund`.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SHIM_DIR = resolve(import.meta.dir, "../../npx-cli");
const SKIP = process.env.APOHARA_SKIP_NPX_E2E === "1";

function hasNpm(): boolean {
	const r = spawnSync("npm", ["--version"], { encoding: "utf-8" });
	return r.status === 0;
}

describe.skipIf(SKIP || !hasNpm())(
	"G7.D.6 — npx tarball E2E",
	() => {
		test(
			"npm pack → install → `--version` prints the package version",
			async () => {
				const pkgRaw = await readFile(
					join(SHIM_DIR, "package.json"),
					"utf-8",
				);
				const pkg = JSON.parse(pkgRaw) as {
					name: string;
					version: string;
				};
				expect(pkg.name).toBe("apohara");

				// 1. Build the bundle so `dist/cli.js` exists. The shim's
				//    build script is `bun build src/cli.ts --target node
				//    --outfile dist/cli.js`, idempotent + ~200 ms.
				const buildResult = spawnSync("bun", ["run", "build"], {
					cwd: SHIM_DIR,
					encoding: "utf-8",
					timeout: 60_000,
				});
				if (buildResult.status !== 0) {
					throw new Error(
						`npx-cli build failed (exit ${buildResult.status}):\n` +
							`stdout: ${buildResult.stdout}\nstderr: ${buildResult.stderr}`,
					);
				}
				expect(existsSync(join(SHIM_DIR, "dist", "cli.js"))).toBe(true);

				// 2. Pack into a scratch dir.
				const sandbox = await mkdtemp(join(tmpdir(), "apohara-npx-e2e-"));
				try {
					const packResult = spawnSync(
						"npm",
						["pack", "--pack-destination", sandbox, "--silent"],
						{
							cwd: SHIM_DIR,
							encoding: "utf-8",
							timeout: 60_000,
						},
					);
					if (packResult.status !== 0) {
						throw new Error(
							`npm pack failed (exit ${packResult.status}):\n` +
								`stdout: ${packResult.stdout}\nstderr: ${packResult.stderr}`,
						);
					}
					// npm pack prints just the filename on stdout in --silent
					// mode; trim and split in case of trailing whitespace.
					const tarballName =
						packResult.stdout.trim().split("\n").pop() ??
						`apohara-${pkg.version}.tgz`;
					const tarballPath = join(sandbox, tarballName);
					expect(existsSync(tarballPath)).toBe(true);

					// 3. Install into the sandbox (no global pollution).
					const prefix = join(sandbox, "prefix");
					const installResult = spawnSync(
						"npm",
						[
							"install",
							"--prefix",
							prefix,
							"--no-audit",
							"--no-fund",
							"--ignore-scripts",
							"--silent",
							tarballPath,
						],
						{
							encoding: "utf-8",
							timeout: 90_000,
							// CI runners sometimes lack a cached npm registry;
							// the shim has no prod deps so install runs offline
							// in the happy path.
							env: { ...process.env, npm_config_loglevel: "error" },
						},
					);
					if (installResult.status !== 0) {
						throw new Error(
							`npm install failed (exit ${installResult.status}):\n` +
								`stdout: ${installResult.stdout}\nstderr: ${installResult.stderr}`,
						);
					}

					// 4. Invoke `--version` via node directly. We avoid
					//    `npx apohara` because the registry lookup races the
					//    local install and can pull a stale stub on slow
					//    network paths.
					const installedCli = join(
						prefix,
						"node_modules",
						"apohara",
						"dist",
						"cli.js",
					);
					expect(existsSync(installedCli)).toBe(true);

					const versionResult = spawnSync(
						"node",
						[installedCli, "--version"],
						{
							encoding: "utf-8",
							timeout: 30_000,
						},
					);
					expect(versionResult.status).toBe(0);
					expect(versionResult.stdout.trim()).toBe(`apohara ${pkg.version}`);
				} finally {
					await rm(sandbox, { recursive: true, force: true });
				}
			},
			120_000,
		);
	},
);
