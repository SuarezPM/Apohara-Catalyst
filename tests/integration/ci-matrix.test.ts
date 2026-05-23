/**
 * W3.8 — Cross-platform CI matrix expansion (verification leg).
 *
 * The companion change in `.github/workflows/ci.yml` expands the test
 * matrix from `3 OS × 1 implicit Node = 3 jobs` to `5 OS × 2 Node =
 * 10 jobs`. This test pins the matrix definition so a future edit that
 * silently regresses the coverage (e.g. drops an OS or a Node version)
 * fails CI locally before it reaches the runners.
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
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const CI_YAML = readFileSync(
	path.join(process.cwd(), ".github/workflows/ci.yml"),
	"utf-8",
);

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

test("APOHARA_MOCK_EMBEDDINGS is set (CLAUDE.md §8.1 OOM rule)", () => {
	expect(CI_YAML).toContain("APOHARA_MOCK_EMBEDDINGS");
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
	// Heuristic: count distinct OS entries × Node entries in the YAML.
	const osEntries = CI_YAML
		.split(/\r?\n/)
		.filter((l) => /^\s*-\s+(ubuntu|macos|windows)-/.test(l));
	const nodeEntries = CI_YAML
		.split(/\r?\n/)
		.filter((l) => /^\s*-\s+"(20|22)"/.test(l));
	expect(osEntries.length).toBe(5);
	expect(nodeEntries.length).toBe(2);
	expect(osEntries.length * nodeEntries.length).toBe(10);
});
