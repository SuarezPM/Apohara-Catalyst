import { expect, test } from "bun:test";
import {
	PeekAttributionLog,
	type PeekRecord,
} from "../../src/core/peek-attribution";

test("records a peek with who/what/when", () => {
	const log = new PeekAttributionLog();
	log.record({ agent: "claude", target: "src/foo.ts", at: 1000 });
	const all = log.list();
	expect(all).toHaveLength(1);
	expect(all[0]).toEqual({
		agent: "claude",
		target: "src/foo.ts",
		at: 1000,
	} satisfies PeekRecord);
});

test("filter by agent and by target", () => {
	const log = new PeekAttributionLog();
	log.record({ agent: "claude", target: "a.ts", at: 1 });
	log.record({ agent: "codex", target: "a.ts", at: 2 });
	log.record({ agent: "claude", target: "b.ts", at: 3 });

	expect(log.byAgent("claude")).toHaveLength(2);
	expect(log.byTarget("a.ts")).toHaveLength(2);
	expect(log.byAgent("claude").map((r) => r.target)).toEqual(["a.ts", "b.ts"]);
});

test("auto-fills timestamp when 'at' omitted", () => {
	const log = new PeekAttributionLog();
	const before = Date.now();
	log.record({ agent: "claude", target: "x" });
	const after = Date.now();
	const rec = log.list()[0];
	expect(rec.at).toBeGreaterThanOrEqual(before);
	expect(rec.at).toBeLessThanOrEqual(after);
});

test("clear empties the log", () => {
	const log = new PeekAttributionLog();
	log.record({ agent: "claude", target: "x", at: 1 });
	log.clear();
	expect(log.list()).toEqual([]);
});
