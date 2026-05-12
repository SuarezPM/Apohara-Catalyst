import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { StateMachine } from "../src/core/state";

describe("StateMachine", () => {
	const TEST_FILE = join(process.cwd(), "tests/tmp-apohara", "state.json");
	const TMP_FILE = `${TEST_FILE}.tmp`;

	beforeEach(async () => {
		await rm(join(process.cwd(), "tests/tmp-apohara"), {
			recursive: true,
			force: true,
		});
	});

	afterEach(async () => {
		await rm(join(process.cwd(), "tests/tmp-apohara"), {
			recursive: true,
			force: true,
		});
	});

	it("should create initial state if file does not exist", async () => {
		const sm = new StateMachine(TEST_FILE);
		const state = await sm.load();
		expect(state.status).toBe("idle");
		expect(state.tasks).toEqual([]);
		expect(state.currentTaskId).toBeNull();
	});

	it("should update state and write atomically to disk", async () => {
		const sm = new StateMachine(TEST_FILE);
		await sm.load(); // Initializes

		await sm.update((state) => {
			return { ...state, status: "running", currentTaskId: "T01" };
		});

		// Reload state from disk to verify persistence
		const sm2 = new StateMachine(TEST_FILE);
		const state2 = await sm2.load();

		expect(state2.status).toBe("running");
		expect(state2.currentTaskId).toBe("T01");

		// Verify tmp file does not exist (cleanup successful)
		let tmpExists = true;
		try {
			await stat(TMP_FILE);
		} catch {
			tmpExists = false;
		}
		expect(tmpExists).toBe(false);
	});
});
