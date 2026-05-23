/**
 * W3.8 — Cross-platform CI matrix expansion (verification leg).
 * G7.E.4 — extended to coexist with the `cross-platform-smoke` job.
 *
 * The companion change in `.github/workflows/ci.yml` expands the test
 * matrix from `3 OS × 1 implicit Node = 3 jobs` to `5 OS × 2 Node =
 * 10 jobs`. This test pins the matrix definition so a future edit that
 * silently regresses the coverage (e.g. drops an OS or a Node version)
 * fails CI locally before it reaches the runners.
 *
 * Sprint 7 G7.D.2-6 added a second `cross-platform-smoke` matrix on
 * the same workflow (`4 OS × 1 Node = 4 jobs`, no Node 20 lane). The
 * `matrix produces exactly 10 jobs` assertion was originally written
 * against a single matrix block — we now scope the count to the
 * `test` job's matrix only by slicing the YAML at the `cross-platform-smoke:`
 * job header. This keeps the contract precise (the *primary* test
 * matrix is 5×2) while letting the secondary smoke job exist
 * independently.
 *
 * Why a TS test instead of just inspecting the YAML in review?
 *
 *   - Bun runs this on every PR, so a YAML rewrite is caught before
 *     merge instead of after the first matrix run goes red.
 *   - The integration suite is the canonical "what did Sprint 6
 *     promise?" gate; tying the matrix to it keeps the contract
 *     visible in one place.
 *
 * Asserts:
 *   1. matrix.os contains ubuntu-22.04, ubuntu-24.04, macos-13,
 *      macos-14, windows-2022 (no `ubuntu-latest` shortcuts — pin
 *      explicit versions for reproducibility).
 *   2. matrix.node contains "20" and "22" (LTS lanes).
 *   3. fail-fast: false (single-OS regression doesn't mask others).
 *   4. APOHARA_SKIP_DOCKER_E2E=1 is set on the test step (macOS /
 *      windows runners lack docker; skip cleanly).
 *   5. The build step + test step + lint step are all present.
 *   6. (G7.E.4 + G10.A.1) The cross-platform-smoke job runs on 3 OS —
 *      Linux, macos-14 (Apple Silicon only — Intel deprecated Dec 2025),
 *      windows-2022 — across Node 20 + 22.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const CI_YAML = readFileSync(
	path.join(process.cwd(), ".github/workflows/ci.yml"),
	"utf-8",
);

// G7.E.4: slice the YAML to the `test` job only. The cross-platform-smoke
// job is verified separately below. Anchored on the next `  <jobname>:`
// header following the test job to be robust against future job
// additions (`cargo-audit`, `license-scan`, etc., which all follow `test`).
const TEST_JOB_YAML = (() => {
	const testJobIdx = CI_YAML.indexOf("\n  test:\n");
	if (testJobIdx === -1) return CI_YAML;
	const afterTest = CI_YAML.slice(testJobIdx + 1);
	const nextJobMatch = afterTest.match(/\n {2}[a-z][a-z0-9_-]*:\n/);
	if (!nextJobMatch) return CI_YAML.slice(testJobIdx);
	return CI_YAML.slice(testJobIdx, testJobIdx + 1 + nextJobMatch.index!);
})();

test("matrix includes 5 OS versions (no -latest shortcuts)", () => {
	const expected = [
		"ubuntu-22.04",
		"ubuntu-24.04",
		"macos-13",
		"macos-14",
		"windows-2022",
	];
	for (const os of expected) {
		expect(CI_YAML).toContain(os);
	}
	// And no -latest aliases — those drift silently when GitHub re-points.
	expect(CI_YAML).not.toMatch(/\bubuntu-latest\b/);
	expect(CI_YAML).not.toMatch(/\bmacos-latest\b/);
	expect(CI_YAML).not.toMatch(/\bwindows-latest\b/);
});

test("matrix includes Node 20 and 22 LTS lanes", () => {
	expect(CI_YAML).toMatch(/-\s+"20"/);
	expect(CI_YAML).toMatch(/-\s+"22"/);
});

test("fail-fast is disabled", () => {
	expect(CI_YAML).toMatch(/fail-fast:\s*false/);
});

test("docker e2e is skipped on the cross-OS lane", () => {
	expect(CI_YAML).toContain("APOHARA_SKIP_DOCKER_E2E");
});

test("APOHARA_MOCK_EMBEDDINGS is NOT set (G8.A.5 — escape hatch removed)", () => {
	// The Nomic BERT model was swapped for sqlite-vec + blake3 feature
	// hashing in G8.A.1, so the mock-embeddings env var is obsolete.
	// CI must not set it; a regression-guard test in tests/unit/ covers
	// the broader filesystem scan.
	expect(CI_YAML).not.toContain("APOHARA_MOCK_EMBEDDINGS");
});

test("workflow has the three required steps: build, test, lint", () => {
	expect(CI_YAML).toContain("bun run build");
	expect(CI_YAML).toContain("bun test src tests");
	expect(CI_YAML).toContain("biome format");
});

test("setup-node action is referenced (matrix.node interpolated)", () => {
	expect(CI_YAML).toContain("actions/setup-node");
	expect(CI_YAML).toContain("${{ matrix.node }}");
});

test("bun version is pinned (anti-drift)", () => {
	expect(CI_YAML).toMatch(/bun-version:\s*"1\.3\.13"/);
});

test("lint step is gated to a single OS+Node combo (anti-flake)", () => {
	expect(CI_YAML).toMatch(/if:\s+matrix\.os\s+==\s+'ubuntu-24\.04'/);
});

test("matrix produces exactly 10 jobs (5 OS × 2 Node)", () => {
	// Heuristic: count distinct OS entries × Node entries in the `test`
	// job's matrix only (G7.E.4 — the `cross-platform-smoke` job has its
	// own matrix that's asserted separately below).
	const osEntries = TEST_JOB_YAML
		.split(/\r?\n/)
		.filter((l) => /^\s*-\s+(ubuntu|macos|windows)-/.test(l));
	const nodeEntries = TEST_JOB_YAML
		.split(/\r?\n/)
		.filter((l) => /^\s*-\s+"(20|22)"/.test(l));
	expect(osEntries.length).toBe(5);
	expect(nodeEntries.length).toBe(2);
	expect(osEntries.length * nodeEntries.length).toBe(10);
});

// G7.E.4 — verify the secondary cross-platform-smoke job exists and
// covers the user-facing target platforms (Linux + macOS Apple Silicon +
// Windows nativo). G10.A.1 (4a051a2) dropped macos-13 because GitHub
// deprecates Intel macOS runners December 2025. This is the fast-feedback
// canary that catches npx-shim build breaks per OS in seconds instead
// of waiting on the full test matrix.
test("cross-platform-smoke job covers Linux + macOS (Apple Silicon) + Windows × Node 20/22", () => {
	expect(CI_YAML).toContain("cross-platform-smoke:");
	// Extract just the smoke job block to avoid mistakenly matching the
	// `test` matrix entries above.
	const smokeIdx = CI_YAML.indexOf("\n  cross-platform-smoke:\n");
	expect(smokeIdx).toBeGreaterThan(-1);
	const smokeBlock = CI_YAML.slice(smokeIdx);
	// G10.A.1 uses inline-list YAML (`os: [a, b, c]`) instead of
	// dash-bullets; extract OS tokens from the `os:` line directly.
	const osLine = smokeBlock.match(/^\s*os:\s*\[([^\]]+)\]/m);
	expect(osLine).not.toBeNull();
	const smokeOsEntries = osLine![1]
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	expect(smokeOsEntries.length).toBe(3);
	expect(smokeOsEntries).toContain("ubuntu-22.04");
	expect(smokeOsEntries).toContain("macos-14");
	expect(smokeOsEntries).toContain("windows-2022");
	// G10.A.1: Intel macOS deprecated by GitHub Dec 2025 — must NOT appear
	// in the smoke matrix.
	expect(smokeOsEntries).not.toContain("macos-13");
	// Node lanes: 20 and 22 (LTS). Inline-list form `node: ['20', '22']`.
	const nodeLine = smokeBlock.match(/^\s*node:\s*\[([^\]]+)\]/m);
	expect(nodeLine).not.toBeNull();
	const smokeNodeEntries = nodeLine![1]
		.split(",")
		.map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
		.filter(Boolean);
	expect(smokeNodeEntries).toContain("20");
	expect(smokeNodeEntries).toContain("22");
	// And the smoke job must build + invoke the shim end-to-end.
	expect(smokeBlock).toContain("bun run build");
	expect(smokeBlock).toContain("--version");
});
