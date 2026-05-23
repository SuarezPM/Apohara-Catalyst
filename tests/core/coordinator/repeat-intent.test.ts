import { test, expect } from "bun:test";
import { createRepeatIntentDetector } from "../../../src/core/coordinator/repeat-intent";

test("3 of the same intent within 5min fires", () => {
	let now = 1_000_000;
	const d = createRepeatIntentDetector({ clock: () => now });
	expect(d.record("implement")).toBeNull();
	now += 1_000;
	expect(d.record("implement")).toBeNull();
	now += 1_000;
	const evt = d.record("implement");
	expect(evt?.type).toBe("repeat-intent-detected");
	expect(evt?.intent).toBe("implement");
	expect(evt?.count).toBe(3);
});

test("different intents don't combine", () => {
	let now = 1_000_000;
	const d = createRepeatIntentDetector({ clock: () => now });
	expect(d.record("implement")).toBeNull();
	now += 1_000;
	expect(d.record("debug")).toBeNull();
	now += 1_000;
	expect(d.record("refactor")).toBeNull();
});

test("entries older than the window are purged", () => {
	let now = 1_000_000;
	const d = createRepeatIntentDetector({ clock: () => now, windowMs: 1_000 });
	d.record("test");
	now += 600;
	d.record("test");
	now += 600;
	// 2 in window now, plus this 3rd → since the first was 1200ms ago,
	// it should be purged. So count=2.
	const evt = d.record("test");
	expect(evt).toBeNull();
	expect(d.currentCount("test")).toBe(2);
});

test("subscribers receive the event", () => {
	let now = 1_000_000;
	const d = createRepeatIntentDetector({ clock: () => now });
	const events: string[] = [];
	d.onRepeat((e) => events.push(`${e.intent}:${e.count}`));
	d.record("review");
	d.record("review");
	d.record("review");
	expect(events).toEqual(["review:3"]);
});

test("unsubscribe stops events", () => {
	let now = 1_000_000;
	const d = createRepeatIntentDetector({ clock: () => now });
	let count = 0;
	const off = d.onRepeat(() => {
		count++;
	});
	d.record("test");
	d.record("test");
	d.record("test");
	expect(count).toBe(1);
	off();
	// Need 3 MORE recordings beyond the prior fire to re-fire.
	d.record("test");
	d.record("test");
	d.record("test");
	expect(count).toBe(1);
});

test("only re-fires after another full threshold of recordings", () => {
	let now = 1_000_000;
	const d = createRepeatIntentDetector({ clock: () => now });
	expect(d.record("debug")).toBeNull();
	expect(d.record("debug")).toBeNull();
	expect(d.record("debug")?.type).toBe("repeat-intent-detected");
	// One more recording right after — should NOT fire again, only 1 since last fire.
	expect(d.record("debug")).toBeNull();
	// Two more recordings — total since last fire = 3 → fires.
	expect(d.record("debug")).toBeNull();
	const evt = d.record("debug");
	expect(evt?.type).toBe("repeat-intent-detected");
});

test("threshold can be overridden", () => {
	let now = 1_000_000;
	const d = createRepeatIntentDetector({ threshold: 2, clock: () => now });
	expect(d.record("explain")).toBeNull();
	const evt = d.record("explain");
	expect(evt?.type).toBe("repeat-intent-detected");
	expect(evt?.count).toBe(2);
});

test("currentCount reflects window purges", () => {
	let now = 1_000_000;
	const d = createRepeatIntentDetector({ clock: () => now, windowMs: 5_000 });
	d.record("implement");
	d.record("implement");
	expect(d.currentCount("implement")).toBe(2);
	now += 10_000;
	expect(d.currentCount("implement")).toBe(0);
});
