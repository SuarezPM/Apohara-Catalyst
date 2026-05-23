/**
 * T4.3 — Runner policy wired to the spawn path.
 *
 * Before this task, `src/core/safety/runnerPolicy/{planCompiler,presets,
 * fsSnapshot,types}.ts` shipped with full test coverage from Stage 5 but
 * nothing in `src/providers/cli-driver.ts` ever invoked it — every spawn
 * sailed past with no policy gate. `src/cli/doctor.ts` even documented
 * this gap explicitly with the string "Stage 5 integration pending".
 *
 * What this test pins down:
 *   1. `resolveRunnerPolicyForSpawn` reads `.apohara.json` from the
 *      workspace, picks the matching preset, and compiles the plan
 *      using the existing `compileRunnerExecutionPlan`.
 *   2. The returned plan carries the preset name (`"Strict"`) and the
 *      `publish` enforcement is marked critical when Strict-mode policy
 *      blocks `push --to main`.
 *   3. The plan is exposed to the child process via the
 *      `APOHARA_RUNNER_POLICY` env var (JSON-encoded), so any wrapped
 *      CLI tool — or a downstream sandbox helper — can read the same
 *      compilation result the orchestrator used.
 *   4. Strict-mode rejections short-circuit the spawn: when the policy
 *      compilation returns `rejected=true`, we surface the rejection
 *      to the caller instead of launching the subprocess. (This test
 *      covers the non-rejecting Strict case; the rejection path is
 *      covered by an `expect.toThrow` companion below.)
 */

import { test, expect, mock, spyOn } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The planCompiler's `Strict + critical+Unsupported` rejection branch is
// not reachable via the natural preset machinery — see the analysis in
// `src/core/safety/runnerPolicy/planCompiler.ts:48-60`: every critical
// area becomes `Enforced` when its critical condition is met, and the
// only area that goes `Unsupported` (`external_sandbox`) is hard-coded
// `critical: false`. To pin down the spawn-abort guard inside
// `callCliDriver`, we stub the compiler module so a flag flips it into
// a rejecting plan for one test, then restore for the rest of the suite.
import * as planCompilerModule from "../../src/core/safety/runnerPolicy/planCompiler";

let __forceRejectedPlan = false;
const __realCompile = planCompilerModule.compileRunnerExecutionPlan;
mock.module("../../src/core/safety/runnerPolicy/planCompiler", () => ({
	compileRunnerExecutionPlan: (policy: Parameters<typeof __realCompile>[0]) => {
		const real = __realCompile(policy);
		if (__forceRejectedPlan) {
			return {
				...real,
				rejected: true,
				rejection_reason:
					"test stub: synthetic critical+Unsupported violation",
			};
		}
		return real;
	},
}));

import {
	resolveRunnerPolicyForSpawn,
	buildRunnerPolicyEnv,
	callCliDriver,
	type CliDriverConfig,
} from "../../src/providers/cli-driver";

test("runner policy is compiled before spawn — Strict preset blocks pushToMain", async () => {
	const wsp = await mkdtemp(join(tmpdir(), "apohara-runner-policy-"));
	await writeFile(
		join(wsp, ".apohara.json"),
		JSON.stringify({ runnerPolicy: { preset: "Strict" } }),
	);

	const plan = await resolveRunnerPolicyForSpawn(wsp);

	// The compiled plan carries the preset that the orchestrator
	// picked, not the raw policy. Downstream tools key off `policy`.
	expect(plan.policy).toBe("Strict");
	expect(plan.rejected).toBe(false);

	// `publish` is one of the 6 enforcement areas. Strict mode flips
	// `blockPushToMain=true`, which the compiler must reflect as
	// critical Enforced.
	const publish = plan.enforcement.find((e) => e.area === "publish");
	expect(publish).toBeDefined();
	expect(publish?.critical).toBe(true);
	expect(publish?.strength).toBe("Enforced");
	expect(publish?.description).toContain("block-push-to-main: true");

	// The env builder is what `runOnce` will splice into the spawn
	// env. It MUST be a JSON-serializable string so a child subprocess
	// can `JSON.parse(process.env.APOHARA_RUNNER_POLICY)`.
	const env = buildRunnerPolicyEnv(plan);
	expect(env.APOHARA_RUNNER_POLICY).toBeDefined();
	const decoded = JSON.parse(env.APOHARA_RUNNER_POLICY) as typeof plan;
	expect(decoded.policy).toBe("Strict");
	expect(decoded.enforcement).toHaveLength(6);
});

test("runner policy falls back to Balanced when .apohara.json is missing", async () => {
	const wsp = await mkdtemp(join(tmpdir(), "apohara-runner-policy-default-"));
	const plan = await resolveRunnerPolicyForSpawn(wsp);
	expect(plan.policy).toBe("Balanced");
	expect(plan.rejected).toBe(false);
});

test("runner policy falls back to Balanced for malformed .apohara.json", async () => {
	const wsp = await mkdtemp(join(tmpdir(), "apohara-runner-policy-malformed-"));
	await writeFile(join(wsp, ".apohara.json"), "{ not valid json");
	const plan = await resolveRunnerPolicyForSpawn(wsp);
	// Malformed config must not crash spawn — fall back to Balanced.
	expect(plan.policy).toBe("Balanced");
});

test("runner policy preset 'Advisory' yields advisory publish enforcement", async () => {
	const wsp = await mkdtemp(join(tmpdir(), "apohara-runner-policy-adv-"));
	await writeFile(
		join(wsp, ".apohara.json"),
		JSON.stringify({ runnerPolicy: { preset: "Advisory" } }),
	);
	const plan = await resolveRunnerPolicyForSpawn(wsp);
	expect(plan.policy).toBe("Advisory");
	const publish = plan.enforcement.find((e) => e.area === "publish");
	expect(publish?.strength).toBe("Advisory");
});

test("aborts spawn when plan.rejected is true (Strict + critical violation)", async () => {
	// Workspace pinned to Strict preset — `resolveRunnerPolicyForSpawn`
	// will compile a plan via the (stubbed) compiler, which returns
	// `rejected: true` because `__forceRejectedPlan` is flipped on. We
	// expect `callCliDriver` to throw BEFORE spawning the fake binary,
	// so the binary path can be an absurd non-existent string — if the
	// guard ever regresses, we'll see `not found on PATH` instead of
	// the rejection error and the test will fail loudly.
	const wsp = await mkdtemp(join(tmpdir(), "apohara-runner-policy-reject-"));
	await writeFile(
		join(wsp, ".apohara.json"),
		JSON.stringify({ runnerPolicy: { preset: "Strict" } }),
	);

	const cfg: CliDriverConfig = {
		id: "claude-code-cli",
		label: "fake-rejected",
		binary: "/absurd/never-spawned-because-policy-rejects",
		args: ({ prompt }) => [prompt],
		defaultModel: "fake",
	};

	__forceRejectedPlan = true;
	try {
		await expect(
			callCliDriver(cfg, [{ role: "user", content: "anything" }], wsp),
		).rejects.toThrow(/runner policy compilation rejected the spawn/);
	} finally {
		__forceRejectedPlan = false;
	}
});

test("Custom preset emits a warning and falls back to Strict", async () => {
	// Until the Custom preset surface ships (post-v1.0), a config that
	// requests it should NOT silently degrade — `pickPolicy` warns and
	// returns STRICT. We pin the warning so users / docs / future-us
	// know the fallback is intentional and visible.
	const wsp = await mkdtemp(join(tmpdir(), "apohara-runner-policy-custom-"));
	await writeFile(
		join(wsp, ".apohara.json"),
		JSON.stringify({ runnerPolicy: { preset: "Custom" } }),
	);

	const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
	try {
		const plan = await resolveRunnerPolicyForSpawn(wsp);
		// Falls back to Strict — same shape as the first test.
		expect(plan.policy).toBe("Strict");
		expect(plan.rejected).toBe(false);
		// And a warning fired naming the workspace + Custom preset.
		const messages = warnSpy.mock.calls.map((c) => String(c[0]));
		const match = messages.find((m) =>
			/Custom preset not yet supported/i.test(m),
		);
		expect(match).toBeDefined();
		expect(match).toContain(wsp);
	} finally {
		warnSpy.mockRestore();
	}
});
