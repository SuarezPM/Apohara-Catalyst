/**
 * G5.C.8 — EventSource reconnect backfill (chorus H18).
 *
 * On reconnect, the client sends `Last-Event-ID` so the server can backfill
 * events missed during the outage. The client tracks the highest event id
 * seen and exposes it so the wire layer can attach the header.
 */
import { describe, expect, it, beforeEach } from "bun:test";
import { SseReconnectTracker } from "./sse-client.js";

describe("SseReconnectTracker", () => {
	let t: SseReconnectTracker;

	beforeEach(() => {
		t = new SseReconnectTracker();
	});

	it("starts with null Last-Event-ID", () => {
		expect(t.lastEventId()).toBeNull();
	});

	it("records the most recent event id", () => {
		t.record("evt-1");
		t.record("evt-2");
		t.record("evt-3");
		expect(t.lastEventId()).toBe("evt-3");
	});

	it("ignores empty id (per EventSource spec — empty id does not update)", () => {
		t.record("evt-1");
		t.record("");
		expect(t.lastEventId()).toBe("evt-1");
	});

	it("reset() clears the tracker (call on session change)", () => {
		t.record("evt-1");
		t.reset();
		expect(t.lastEventId()).toBeNull();
	});

	it("reconnectHeaders includes Last-Event-ID when set", () => {
		t.record("xyz");
		expect(t.reconnectHeaders()).toEqual({ "Last-Event-ID": "xyz" });
	});

	it("reconnectHeaders is empty when no id captured", () => {
		expect(t.reconnectHeaders()).toEqual({});
	});

	it("survives integer ids cast to string", () => {
		t.record("42");
		expect(t.lastEventId()).toBe("42");
	});

	it("invokes onReconnect callback with last id on reconnect()", () => {
		t.record("evt-5");
		const captured: { value: string | null } = { value: null };
		t.reconnect((id) => {
			captured.value = id;
		});
		expect(captured.value).toBe("evt-5");
	});

	it("onReconnect is null-id when nothing captured yet", () => {
		const captured: { value: string | null | undefined } = {
			value: undefined,
		};
		t.reconnect((id) => {
			captured.value = id;
		});
		expect(captured.value).toBeNull();
	});

	it("countReconnects tracks reconnect invocations", () => {
		t.record("a");
		t.reconnect(() => {});
		t.reconnect(() => {});
		t.reconnect(() => {});
		expect(t.countReconnects()).toBe(3);
	});

	it("countReconnects resets with reset()", () => {
		t.reconnect(() => {});
		t.reconnect(() => {});
		t.reset();
		expect(t.countReconnects()).toBe(0);
	});

	it("backfill stub fetches events after a given id", async () => {
		const events = [
			{ id: "1", data: "a" },
			{ id: "2", data: "b" },
			{ id: "3", data: "c" },
		];
		const got = await t.backfillFrom(events, "1");
		expect(got).toEqual([
			{ id: "2", data: "b" },
			{ id: "3", data: "c" },
		]);
	});

	it("backfill returns all when lastId is null (fresh connection)", async () => {
		const events = [
			{ id: "1", data: "a" },
			{ id: "2", data: "b" },
		];
		const got = await t.backfillFrom(events, null);
		expect(got).toEqual(events);
	});

	it("backfill returns [] when lastId is the most recent", async () => {
		const events = [
			{ id: "1", data: "a" },
			{ id: "2", data: "b" },
		];
		const got = await t.backfillFrom(events, "2");
		expect(got).toEqual([]);
	});

	it("backfill returns [] and warns when lastId is unknown to the server", async () => {
		const events = [
			{ id: "5", data: "e" },
			{ id: "6", data: "f" },
		];
		// Caller doesn't know about id "999" — server can't backfill from
		// the unknown anchor. We return [] (callers retry from scratch).
		const got = await t.backfillFrom(events, "999");
		expect(got).toEqual([]);
	});
});
