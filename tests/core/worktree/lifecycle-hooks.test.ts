import { beforeEach, expect, test } from "bun:test";
import {
	type LifecycleContext,
	type LifecyclePhase,
	WorktreeLifecycleHooks,
} from "../../../src/core/worktree/lifecycle-hooks";

let hooks: WorktreeLifecycleHooks;
beforeEach(() => {
	hooks = new WorktreeLifecycleHooks();
});

const ctx = (taskId = "t-1"): LifecycleContext => ({
	taskId,
	path: `/tmp/wt-${taskId}`,
	branch: "feat/x",
});

test("starts with no hooks registered", () => {
	expect(hooks.countByPhase("pre-create")).toBe(0);
});

test("runs registered hook on matching phase", async () => {
	const calls: LifecyclePhase[] = [];
	hooks.register("pre-create", async (_c) => {
		calls.push("pre-create");
	});
	await hooks.runPhase("pre-create", ctx());
	expect(calls).toEqual(["pre-create"]);
});

test("runs hooks in registration order (FIFO)", async () => {
	const order: number[] = [];
	hooks.register("post-create", async () => {
		order.push(1);
	});
	hooks.register("post-create", async () => {
		order.push(2);
	});
	hooks.register("post-create", async () => {
		order.push(3);
	});
	await hooks.runPhase("post-create", ctx());
	expect(order).toEqual([1, 2, 3]);
});

test("filters by phase — pre-create hook does not run on post-create", async () => {
	const calls: LifecyclePhase[] = [];
	hooks.register("pre-create", async () => {
		calls.push("pre-create");
	});
	hooks.register("post-create", async () => {
		calls.push("post-create");
	});
	await hooks.runPhase("post-create", ctx());
	expect(calls).toEqual(["post-create"]);
});

test("supports all 4 phases", async () => {
	const calls: LifecyclePhase[] = [];
	for (const p of [
		"pre-create",
		"post-create",
		"pre-teardown",
		"post-teardown",
	] as const) {
		hooks.register(p, async () => {
			calls.push(p);
		});
	}
	await hooks.runPhase("pre-create", ctx());
	await hooks.runPhase("post-create", ctx());
	await hooks.runPhase("pre-teardown", ctx());
	await hooks.runPhase("post-teardown", ctx());
	expect(calls).toEqual([
		"pre-create",
		"post-create",
		"pre-teardown",
		"post-teardown",
	]);
});

test("propagates context to hooks", async () => {
	let received: LifecycleContext | null = null;
	hooks.register("post-create", async (c) => {
		received = c;
	});
	const c = ctx("task-abc");
	await hooks.runPhase("post-create", c);
	expect(received).toEqual(c);
});

test("a failing hook aborts the phase and surfaces the error", async () => {
	const calls: string[] = [];
	hooks.register("pre-create", async () => {
		calls.push("a");
	});
	hooks.register("pre-create", async () => {
		throw new Error("boom");
	});
	hooks.register("pre-create", async () => {
		calls.push("c");
	});
	await expect(hooks.runPhase("pre-create", ctx())).rejects.toThrow("boom");
	expect(calls).toEqual(["a"]); // 'c' never runs
});

test("teardown phases continue past failures (best-effort cleanup)", async () => {
	const calls: string[] = [];
	hooks.register("pre-teardown", async () => {
		calls.push("a");
	});
	hooks.register("pre-teardown", async () => {
		throw new Error("ignored");
	});
	hooks.register("pre-teardown", async () => {
		calls.push("c");
	});
	// Teardown phases must NOT throw — they're cleanup paths and a hook
	// failure shouldn't leak a worktree.
	await hooks.runPhase("pre-teardown", ctx());
	expect(calls).toEqual(["a", "c"]);
});

test("returns errors collected during teardown for caller diagnostics", async () => {
	hooks.register("post-teardown", async () => {
		throw new Error("first");
	});
	hooks.register("post-teardown", async () => {
		throw new Error("second");
	});
	const errors = await hooks.runPhaseCollectErrors("post-teardown", ctx());
	expect(errors).toHaveLength(2);
	expect(errors[0]?.message).toBe("first");
	expect(errors[1]?.message).toBe("second");
});

test("unregister removes a specific hook by reference", async () => {
	const calls: string[] = [];
	const h1 = async () => {
		calls.push("h1");
	};
	const h2 = async () => {
		calls.push("h2");
	};
	hooks.register("pre-create", h1);
	hooks.register("pre-create", h2);
	hooks.unregister("pre-create", h1);
	await hooks.runPhase("pre-create", ctx());
	expect(calls).toEqual(["h2"]);
});

test("countByPhase reflects registration state", () => {
	expect(hooks.countByPhase("pre-create")).toBe(0);
	hooks.register("pre-create", async () => {});
	hooks.register("pre-create", async () => {});
	hooks.register("post-create", async () => {});
	expect(hooks.countByPhase("pre-create")).toBe(2);
	expect(hooks.countByPhase("post-create")).toBe(1);
});
