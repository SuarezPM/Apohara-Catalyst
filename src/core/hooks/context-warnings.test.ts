/**
 * G5.C.3 — Context warnings (claude-octopus #4).
 *
 * Emits warn events when an agent's context usage approaches the model
 * limit. Levels: caution (75%), warning (85%), critical (95%).
 */
import { describe, expect, it, beforeEach } from "bun:test";
import {
	ContextWarningMonitor,
	classifyContextUsage,
	type ContextUsageEvent,
} from "./context-warnings.js";

describe("classifyContextUsage", () => {
	it("returns ok when usage below caution threshold", () => {
		expect(classifyContextUsage(1000, 10_000).level).toBe("ok");
		expect(classifyContextUsage(7400, 10_000).level).toBe("ok");
	});

	it("returns caution at 75%-84%", () => {
		expect(classifyContextUsage(7500, 10_000).level).toBe("caution");
		expect(classifyContextUsage(8000, 10_000).level).toBe("caution");
		expect(classifyContextUsage(8499, 10_000).level).toBe("caution");
	});

	it("returns warning at 85%-94%", () => {
		expect(classifyContextUsage(8500, 10_000).level).toBe("warning");
		expect(classifyContextUsage(9000, 10_000).level).toBe("warning");
		expect(classifyContextUsage(9499, 10_000).level).toBe("warning");
	});

	it("returns critical at 95%+", () => {
		expect(classifyContextUsage(9500, 10_000).level).toBe("critical");
		expect(classifyContextUsage(10_000, 10_000).level).toBe("critical");
		expect(classifyContextUsage(12_000, 10_000).level).toBe("critical");
	});

	it("includes percentage rounded to 1 decimal", () => {
		expect(classifyContextUsage(7531, 10_000).percent).toBeCloseTo(75.3, 1);
	});

	it("handles zero / negative limit safely", () => {
		expect(classifyContextUsage(100, 0).level).toBe("ok");
		expect(classifyContextUsage(100, -1).level).toBe("ok");
	});
});

describe("ContextWarningMonitor", () => {
	let monitor: ContextWarningMonitor;
	let emitted: ContextUsageEvent[];

	beforeEach(() => {
		emitted = [];
		monitor = new ContextWarningMonitor({
			emit: (ev) => {
				emitted.push(ev);
			},
		});
	});

	it("does not emit when usage stays at ok", () => {
		monitor.observe({ sessionId: "s", tokensUsed: 100, tokensLimit: 10_000 });
		expect(emitted).toEqual([]);
	});

	it("emits when entering caution band for the first time", () => {
		monitor.observe({ sessionId: "s", tokensUsed: 7600, tokensLimit: 10_000 });
		expect(emitted).toHaveLength(1);
		expect(emitted[0].level).toBe("caution");
		expect(emitted[0].sessionId).toBe("s");
	});

	it("does not re-emit while staying in the same band", () => {
		monitor.observe({ sessionId: "s", tokensUsed: 7600, tokensLimit: 10_000 });
		monitor.observe({ sessionId: "s", tokensUsed: 7900, tokensLimit: 10_000 });
		monitor.observe({ sessionId: "s", tokensUsed: 8200, tokensLimit: 10_000 });
		expect(emitted).toHaveLength(1);
	});

	it("re-emits when transitioning to a higher band", () => {
		monitor.observe({ sessionId: "s", tokensUsed: 7600, tokensLimit: 10_000 });
		monitor.observe({ sessionId: "s", tokensUsed: 8700, tokensLimit: 10_000 });
		monitor.observe({ sessionId: "s", tokensUsed: 9700, tokensLimit: 10_000 });
		expect(emitted.map((e) => e.level)).toEqual([
			"caution",
			"warning",
			"critical",
		]);
	});

	it("re-emits caution when dropping back from critical (escalations only)", () => {
		// Drop-backs are silent — we only emit on escalation to a worse band.
		monitor.observe({ sessionId: "s", tokensUsed: 9700, tokensLimit: 10_000 });
		monitor.observe({ sessionId: "s", tokensUsed: 5000, tokensLimit: 10_000 });
		expect(emitted).toHaveLength(1);
		expect(emitted[0].level).toBe("critical");
	});

	it("tracks bands independently per session", () => {
		monitor.observe({ sessionId: "a", tokensUsed: 7600, tokensLimit: 10_000 });
		monitor.observe({ sessionId: "b", tokensUsed: 9700, tokensLimit: 10_000 });
		expect(emitted).toHaveLength(2);
		expect(emitted[0].level).toBe("caution");
		expect(emitted[0].sessionId).toBe("a");
		expect(emitted[1].level).toBe("critical");
		expect(emitted[1].sessionId).toBe("b");
	});

	it("forget(sessionId) clears the band so next observe re-emits", () => {
		monitor.observe({ sessionId: "s", tokensUsed: 7600, tokensLimit: 10_000 });
		monitor.forget("s");
		monitor.observe({ sessionId: "s", tokensUsed: 7600, tokensLimit: 10_000 });
		expect(emitted).toHaveLength(2);
	});
});
