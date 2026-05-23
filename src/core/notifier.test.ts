/**
 * G5.C.7 — Notifier multi-subscribe (chorus H19).
 *
 * Multi-subscriber EventBus where each channel can have N independent
 * subscribers. Backed by a per-channel Set. Subscribe returns an
 * unsubscribe handle; publishing fans out to every active subscriber.
 */
import { describe, expect, it, beforeEach } from "bun:test";
import { Notifier } from "./notifier.js";

describe("Notifier", () => {
	let n: Notifier<{ msg: string }>;

	beforeEach(() => {
		n = new Notifier();
	});

	it("publish without subscribers is a noop", () => {
		const out = n.publish("ch", { msg: "x" });
		expect(out.delivered).toBe(0);
	});

	it("delivers to a single subscriber", () => {
		const seen: string[] = [];
		n.subscribe("ch", (p) => {
			seen.push(p.msg);
		});
		const out = n.publish("ch", { msg: "hi" });
		expect(out.delivered).toBe(1);
		expect(seen).toEqual(["hi"]);
	});

	it("delivers to multiple subscribers on the same channel", () => {
		const a: string[] = [];
		const b: string[] = [];
		n.subscribe("ch", (p) => {
			a.push(p.msg);
		});
		n.subscribe("ch", (p) => {
			b.push(p.msg);
		});
		n.publish("ch", { msg: "1" });
		n.publish("ch", { msg: "2" });
		expect(a).toEqual(["1", "2"]);
		expect(b).toEqual(["1", "2"]);
	});

	it("isolates channels", () => {
		const seenA: string[] = [];
		const seenB: string[] = [];
		n.subscribe("a", (p) => {
			seenA.push(p.msg);
		});
		n.subscribe("b", (p) => {
			seenB.push(p.msg);
		});
		n.publish("a", { msg: "to-a" });
		n.publish("b", { msg: "to-b" });
		expect(seenA).toEqual(["to-a"]);
		expect(seenB).toEqual(["to-b"]);
	});

	it("unsubscribe handle removes only the matching subscriber", () => {
		const a: string[] = [];
		const b: string[] = [];
		const handleA = n.subscribe("ch", (p) => {
			a.push(p.msg);
		});
		n.subscribe("ch", (p) => {
			b.push(p.msg);
		});
		handleA.unsubscribe();
		n.publish("ch", { msg: "post" });
		expect(a).toEqual([]);
		expect(b).toEqual(["post"]);
	});

	it("unsubscribe is idempotent", () => {
		const handle = n.subscribe("ch", () => {});
		handle.unsubscribe();
		handle.unsubscribe();
		expect(n.subscriberCount("ch")).toBe(0);
	});

	it("subscriberCount returns 0 for unknown channels", () => {
		expect(n.subscriberCount("never")).toBe(0);
	});

	it("isolates errors thrown by one subscriber from the rest", () => {
		const a: string[] = [];
		const b: string[] = [];
		n.subscribe("ch", () => {
			throw new Error("boom");
		});
		n.subscribe("ch", (p) => {
			a.push(p.msg);
		});
		n.subscribe("ch", (p) => {
			b.push(p.msg);
		});
		const out = n.publish("ch", { msg: "x" });
		expect(out.delivered).toBe(2);
		expect(out.errors).toHaveLength(1);
		expect(a).toEqual(["x"]);
		expect(b).toEqual(["x"]);
	});

	it("clear() removes all subscribers from a channel", () => {
		n.subscribe("ch", () => {});
		n.subscribe("ch", () => {});
		expect(n.subscriberCount("ch")).toBe(2);
		n.clear("ch");
		expect(n.subscriberCount("ch")).toBe(0);
	});

	it("clearAll() wipes every channel", () => {
		n.subscribe("a", () => {});
		n.subscribe("b", () => {});
		n.clearAll();
		expect(n.subscriberCount("a")).toBe(0);
		expect(n.subscriberCount("b")).toBe(0);
	});

	it("supports async subscribers (does not crash on returned promise)", async () => {
		const seen: string[] = [];
		n.subscribe("ch", async (p) => {
			await Promise.resolve();
			seen.push(p.msg);
		});
		n.publish("ch", { msg: "a" });
		// Yield to let the microtask drain
		await Promise.resolve();
		expect(seen).toEqual(["a"]);
	});

	it("listChannels() returns active channels with subscribers", () => {
		n.subscribe("a", () => {});
		n.subscribe("b", () => {});
		expect(new Set(n.listChannels())).toEqual(new Set(["a", "b"]));
	});

	it("listChannels() does not include cleared channels", () => {
		const h = n.subscribe("a", () => {});
		h.unsubscribe();
		expect(n.listChannels()).toEqual([]);
	});
});
