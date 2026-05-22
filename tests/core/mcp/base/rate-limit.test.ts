import { test, expect } from "bun:test";
import { TokenBucket } from "../../../../src/core/mcp/base/rateLimit.js";

test("allows up to perMinute calls in same window", () => {
  const b = new TokenBucket({ perMinute: 3, perHour: 100 });
  const ts = Date.now();
  expect(b.tryConsume(ts)).toBe(true);
  expect(b.tryConsume(ts)).toBe(true);
  expect(b.tryConsume(ts)).toBe(true);
  expect(b.tryConsume(ts)).toBe(false);
});

test("refills on new minute", () => {
  const b = new TokenBucket({ perMinute: 1, perHour: 100 });
  const ts = 60_000 * 100;
  expect(b.tryConsume(ts)).toBe(true);
  expect(b.tryConsume(ts)).toBe(false);
  expect(b.tryConsume(ts + 60_000)).toBe(true);
});

test("blocks on hour limit even if minute resets", () => {
  const b = new TokenBucket({ perMinute: 100, perHour: 2 });
  const ts = 3_600_000 * 50;
  expect(b.tryConsume(ts)).toBe(true);
  expect(b.tryConsume(ts)).toBe(true);
  expect(b.tryConsume(ts + 60_000)).toBe(false);
});
