import { expect, test } from "bun:test";
import { CostCap } from "../../../src/core/orchestration/yolo-cost-cap";

test("cap allows spend under limit", () => {
	const cap = new CostCap({ maxUsd: 10 });
	expect(cap.tryReserve(3)).toBe(true);
	expect(cap.tryReserve(5)).toBe(true);
	expect(cap.totalSpentUsd()).toBe(8);
});

test("cap rejects spend that would exceed limit", () => {
	const cap = new CostCap({ maxUsd: 10 });
	cap.tryReserve(7);
	expect(cap.tryReserve(5)).toBe(false); // 7 + 5 = 12 > 10
	expect(cap.totalSpentUsd()).toBe(7); // not incremented on reject
});

test("cap at exactly limit allows last spend then blocks", () => {
	const cap = new CostCap({ maxUsd: 10 });
	expect(cap.tryReserve(10)).toBe(true);
	expect(cap.tryReserve(0.01)).toBe(false);
});
