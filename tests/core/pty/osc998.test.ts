/**
 * Tests for OSC 998 command-state escape parser (G5.I.5).
 */
import { describe, expect, test } from "bun:test";
import { createOsc998Parser } from "../../../src/core/pty/osc998";

const ESC = "";
const BEL = "";

function osc(payload: string): string {
	return `${ESC}]998;${payload}${BEL}`;
}

function oscST(payload: string): string {
	return `${ESC}]998;${payload}${ESC}\\`;
}

describe("createOsc998Parser", () => {
	test("passes plain output through unchanged", () => {
		const p = createOsc998Parser();
		const r = p.feed("hello world\n");
		expect(r.clean).toBe("hello world\n");
		expect(r.events).toEqual([]);
	});

	test("parses single BEL-terminated event", () => {
		const p = createOsc998Parser();
		const r = p.feed(`before${osc('{"state":"running"}')}after`);
		expect(r.clean).toBe("beforeafter");
		expect(r.events).toHaveLength(1);
		expect(r.events[0].payload).toEqual({ state: "running" });
		expect(r.events[0].raw).toBe('{"state":"running"}');
	});

	test("parses single ST-terminated event", () => {
		const p = createOsc998Parser();
		const r = p.feed(oscST('{"state":"done"}'));
		expect(r.clean).toBe("");
		expect(r.events).toHaveLength(1);
		expect(r.events[0].payload).toEqual({ state: "done" });
	});

	test("parses multiple events in one chunk", () => {
		const p = createOsc998Parser();
		const r = p.feed(`${osc('{"a":1}')}between${osc('{"a":2}')}tail`);
		expect(r.clean).toBe("betweentail");
		expect(r.events).toHaveLength(2);
		expect(r.events[0].payload).toEqual({ a: 1 });
		expect(r.events[1].payload).toEqual({ a: 2 });
	});

	test("preserves payload as null when JSON is malformed", () => {
		const p = createOsc998Parser();
		const r = p.feed(osc("not-valid-json"));
		expect(r.events).toHaveLength(1);
		expect(r.events[0].payload).toBeNull();
		expect(r.events[0].raw).toBe("not-valid-json");
	});

	test("reassembles sequence split across chunks", () => {
		const p = createOsc998Parser();
		const r1 = p.feed(`prefix${ESC}]998;{"sta`);
		expect(r1.clean).toBe("prefix");
		expect(r1.events).toEqual([]);

		const r2 = p.feed(`te":"x"}${BEL}suffix`);
		expect(r2.clean).toBe("suffix");
		expect(r2.events).toHaveLength(1);
		expect(r2.events[0].payload).toEqual({ state: "x" });
	});

	test("holds partial prefix across chunks", () => {
		const p = createOsc998Parser();
		const r1 = p.feed(`text${ESC}]99`);
		// Should NOT emit the partial prefix as visible output.
		expect(r1.clean).toBe("text");

		const r2 = p.feed(`8;{"k":1}${BEL}`);
		expect(r2.events).toHaveLength(1);
		expect(r2.events[0].payload).toEqual({ k: 1 });
	});

	test("reset() clears carry buffer", () => {
		const p = createOsc998Parser();
		p.feed(`${ESC}]998;{"a`);
		p.reset();
		const r = p.feed("plain");
		expect(r.clean).toBe("plain");
		expect(r.events).toEqual([]);
	});

	test("drops runaway unterminated sequences past the carry cap", () => {
		const p = createOsc998Parser();
		const huge = "x".repeat(70 * 1024);
		const r1 = p.feed(`${ESC}]998;${huge}`);
		expect(r1.events).toEqual([]);
		// After the cap, subsequent valid sequences still parse.
		const r2 = p.feed(`${osc('{"recovered":true}')}`);
		expect(r2.events).toHaveLength(1);
		expect(r2.events[0].payload).toEqual({ recovered: true });
	});

	test("handles empty chunk without crashing", () => {
		const p = createOsc998Parser();
		const r = p.feed("");
		expect(r.clean).toBe("");
		expect(r.events).toEqual([]);
	});
});
