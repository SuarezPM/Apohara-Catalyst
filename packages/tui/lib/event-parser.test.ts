import { beforeEach, describe, expect, it } from "vitest";
import type { EventLog } from "../../../src/core/types";
import { EventParser, KNOWN_EVENT_TYPES } from "./event-parser";

function makeEvent(overrides: Partial<EventLog> = {}): EventLog {
	return {
		id: "evt-1",
		timestamp: new Date().toISOString(),
		type: "task_completed",
		severity: "info",
		payload: { ok: true },
		...overrides,
	};
}

describe("EventParser", () => {
	let parser: EventParser;

	beforeEach(() => {
		parser = new EventParser();
	});

	it("parses a valid event", () => {
		const line = JSON.stringify(makeEvent());
		const result = parser.parseLine(line);
		expect(result.event).not.toBeNull();
		expect(result.malformed).toBe(false);
		expect(result.unknownType).toBe(false);
	});

	it("counts empty string as malformed", () => {
		parser.parseLine("");
		expect(parser.malformedLines).toBe(1);
		expect(parser.unknownEventTypes).toBe(0);
	});

	it("counts whitespace-only line as malformed", () => {
		parser.parseLine("   ");
		expect(parser.malformedLines).toBe(1);
	});

	it("counts invalid JSON as malformed", () => {
		parser.parseLine("not json");
		expect(parser.malformedLines).toBe(1);
	});

	it("counts missing id as malformed", () => {
		const line = JSON.stringify({
			timestamp: "2024-01-01",
			type: "task_completed",
			severity: "info",
			payload: {},
		});
		parser.parseLine(line);
		expect(parser.malformedLines).toBe(1);
	});

	it("counts missing timestamp as malformed", () => {
		const line = JSON.stringify({
			id: "1",
			type: "task_completed",
			severity: "info",
			payload: {},
		});
		parser.parseLine(line);
		expect(parser.malformedLines).toBe(1);
	});

	it("counts missing type as malformed", () => {
		const line = JSON.stringify({
			id: "1",
			timestamp: "2024-01-01",
			severity: "info",
			payload: {},
		});
		parser.parseLine(line);
		expect(parser.malformedLines).toBe(1);
	});

	it("counts missing severity as malformed", () => {
		const line = JSON.stringify({
			id: "1",
			timestamp: "2024-01-01",
			type: "task_completed",
			payload: {},
		});
		parser.parseLine(line);
		expect(parser.malformedLines).toBe(1);
	});

	it("counts wrong severity as malformed", () => {
		const line = JSON.stringify(makeEvent({ severity: "critical" as any }));
		parser.parseLine(line);
		expect(parser.malformedLines).toBe(1);
	});

	it("counts payload array as malformed", () => {
		const line = JSON.stringify(makeEvent({ payload: [] as any }));
		parser.parseLine(line);
		expect(parser.malformedLines).toBe(1);
	});

	it("counts metadata array as malformed", () => {
		const line = JSON.stringify(makeEvent({ metadata: [] as any }));
		parser.parseLine(line);
		expect(parser.malformedLines).toBe(1);
	});

	it("counts unknown event type", () => {
		const line = JSON.stringify(makeEvent({ type: "mystery_event" }));
		const result = parser.parseLine(line);
		expect(result.event).not.toBeNull();
		expect(result.unknownType).toBe(true);
		expect(parser.unknownEventTypes).toBe(1);
		expect(parser.malformedLines).toBe(0);
	});

	it("accepts all known event types", () => {
		for (const type of KNOWN_EVENT_TYPES) {
			parser = new EventParser();
			const line = JSON.stringify(makeEvent({ type }));
			const result = parser.parseLine(line);
			expect(result.malformed).toBe(false);
			expect(result.unknownType).toBe(false);
		}
	});

	it("handles single-line file", () => {
		const line = JSON.stringify(makeEvent());
		const result = parser.parseLine(line);
		expect(result.event).not.toBeNull();
	});

	it("handles very long line", () => {
		const line = JSON.stringify(
			makeEvent({ payload: { data: "x".repeat(100_000) } }),
		);
		const result = parser.parseLine(line);
		expect(result.event).not.toBeNull();
	});

	it("does not count valid lines as malformed or unknown", () => {
		parser.parseLine(JSON.stringify(makeEvent()));
		parser.parseLine(
			JSON.stringify(makeEvent({ type: "task_failed", severity: "error" })),
		);
		expect(parser.malformedLines).toBe(0);
		expect(parser.unknownEventTypes).toBe(0);
	});
});
