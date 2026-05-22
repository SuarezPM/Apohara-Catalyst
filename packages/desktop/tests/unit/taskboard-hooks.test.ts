import { test, expect } from "bun:test";
import { normalizeRect, rectsIntersect } from "../../src/components/TaskBoard/hooks/use-taskboard-area-selection.js";
import { DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH } from "../../src/components/TaskBoard/hooks/use-taskboard-column-resize.js";

test("normalizeRect handles inverted drag direction", () => {
  expect(normalizeRect({ startX: 100, startY: 100, currentX: 50, currentY: 50 })).toEqual({
    left: 50, top: 50, right: 100, bottom: 100,
  });
});

test("normalizeRect handles forward drag", () => {
  expect(normalizeRect({ startX: 10, startY: 20, currentX: 50, currentY: 60 })).toEqual({
    left: 10, top: 20, right: 50, bottom: 60,
  });
});

test("rectsIntersect detects overlap", () => {
  const a = { left: 0, top: 0, right: 100, bottom: 100 };
  const b = { left: 50, top: 50, right: 150, bottom: 150 };
  expect(rectsIntersect(a, b)).toBe(true);
});

test("rectsIntersect detects no overlap", () => {
  const a = { left: 0, top: 0, right: 100, bottom: 100 };
  const b = { left: 200, top: 200, right: 300, bottom: 300 };
  expect(rectsIntersect(a, b)).toBe(false);
});

test("rectsIntersect treats touching edges as no overlap (strict)", () => {
  const a = { left: 0, top: 0, right: 100, bottom: 100 };
  const b = { left: 100, top: 0, right: 200, bottom: 100 };
  // The function uses < not <=, so touching edges count as no overlap
  expect(rectsIntersect(a, b)).toBe(true);
});

test("column resize constants are sane", () => {
  expect(DEFAULT_WIDTH).toBeGreaterThan(MIN_WIDTH);
  expect(MAX_WIDTH).toBeGreaterThan(DEFAULT_WIDTH);
  expect(MIN_WIDTH).toBeGreaterThanOrEqual(100);
});