/**
 * G5.C.5 — Learnings dump (claude-octopus #9).
 *
 * On session end, collect structured learnings from the run: discoveries,
 * decisions, conventions found, incidents, suggested next steps. Persist
 * to disk as JSON so the next session can read it as additionalContext.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	LearningsCollector,
	type LearningEntry,
} from "./learnings-dump.js";

describe("LearningsCollector", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "apohara-learnings-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("starts empty", () => {
		const c = new LearningsCollector();
		expect(c.snapshot()).toEqual({
			discoveries: [],
			decisions: [],
			incidents: [],
			conventions: [],
			nextSteps: [],
		});
	});

	it("collects entries by category", () => {
		const c = new LearningsCollector();
		c.add({
			category: "discoveries",
			title: "found undocumented flag",
			detail: "--mock-embeddings skips Nomic model load",
		});
		c.add({
			category: "decisions",
			title: "use SSE not WebSocket",
			detail: "simpler reconnect semantics",
		});
		c.add({ category: "nextSteps", title: "wire G5.C.6", detail: "depends on this" });
		const snap = c.snapshot();
		expect(snap.discoveries).toHaveLength(1);
		expect(snap.decisions).toHaveLength(1);
		expect(snap.nextSteps).toHaveLength(1);
		expect(snap.incidents).toHaveLength(0);
	});

	it("writes a session JSON file with all categories", async () => {
		const c = new LearningsCollector();
		c.add({
			category: "discoveries",
			title: "x",
			detail: "y",
		});
		c.add({
			category: "incidents",
			title: "timeout at 120s",
			detail: "claude CLI lock contention",
		});
		const outPath = await c.dump({
			sessionId: "session-abc",
			dir: tmpDir,
			finishedAt: 1_000_000_000_000,
			objective: "G5.C work",
		});
		expect(outPath).toContain("session-abc");
		const raw = await readFile(outPath, "utf-8");
		const parsed = JSON.parse(raw) as {
			sessionId: string;
			objective: string;
			finishedAt: number;
			learnings: {
				discoveries: LearningEntry[];
				incidents: LearningEntry[];
			};
		};
		expect(parsed.sessionId).toBe("session-abc");
		expect(parsed.objective).toBe("G5.C work");
		expect(parsed.finishedAt).toBe(1_000_000_000_000);
		expect(parsed.learnings.discoveries).toHaveLength(1);
		expect(parsed.learnings.incidents).toHaveLength(1);
		expect(parsed.learnings.discoveries[0].title).toBe("x");
	});

	it("dump is atomic (written via temp+rename)", async () => {
		const c = new LearningsCollector();
		c.add({ category: "discoveries", title: "a", detail: "b" });
		const out = await c.dump({
			sessionId: "atomic",
			dir: tmpDir,
			finishedAt: 1,
			objective: "test",
		});
		// File exists post-dump
		const stats = await readFile(out, "utf-8");
		expect(stats.length).toBeGreaterThan(0);
		// No leftover temp files
		const leftover = (await import("node:fs/promises"))
			.readdir(tmpDir)
			.then((files) => files.filter((f) => f.startsWith(".tmp.")));
		expect(await leftover).toEqual([]);
	});

	it("renders next-session additionalContext envelope", () => {
		const c = new LearningsCollector();
		c.add({
			category: "decisions",
			title: "use bun:sqlite",
			detail: "native + zero-dep",
		});
		c.add({
			category: "nextSteps",
			title: "wire reconnect backfill",
			detail: "depends on Last-Event-ID",
		});
		const env = c.renderAdditionalContext();
		expect(env.additionalContext).toContain("use bun:sqlite");
		expect(env.additionalContext).toContain("wire reconnect backfill");
		expect(env.additionalContext).toContain("Decisions");
		expect(env.additionalContext).toContain("Next steps");
	});

	it("renderAdditionalContext is empty when nothing collected", () => {
		const c = new LearningsCollector();
		const env = c.renderAdditionalContext();
		expect(env.additionalContext).toBe("");
	});

	it("onHookEvent absorbs stop event into nextSteps", () => {
		const c = new LearningsCollector();
		const out = c.onHookEvent({
			type: "session_stop",
			sessionId: "s",
			reason: "completed",
			timestamp: 1,
		});
		expect(out.action).toBe("recorded");
		const env = c.renderAdditionalContext();
		expect(env.additionalContext).toContain("completed");
	});

	it("ignores unrelated hook events", () => {
		const c = new LearningsCollector();
		const out = c.onHookEvent({
			type: "pre_tool_use",
			sessionId: "s",
			timestamp: 1,
		} as never);
		expect(out.action).toBe("ignored");
	});
});
