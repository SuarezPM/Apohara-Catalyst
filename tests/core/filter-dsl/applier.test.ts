import { expect, test } from "bun:test";
import { parseFilter } from "../../../src/core/filter-dsl/parser";
import { applyFilter } from "../../../src/core/filter-dsl/applier";

test("applier evaluates equality on flat object", () => {
  const ast = parseFilter('status == "ready"');
  expect(applyFilter(ast, { status: "ready" })).toBe(true);
  expect(applyFilter(ast, { status: "done" })).toBe(false);
});

test("applier evaluates AND combination", () => {
  const ast = parseFilter('status == "ready" && cost < 0.5');
  expect(applyFilter(ast, { status: "ready", cost: 0.3 })).toBe(true);
  expect(applyFilter(ast, { status: "ready", cost: 0.8 })).toBe(false);
});

test("applier handles negation", () => {
  const ast = parseFilter('!(status == "failed")');
  expect(applyFilter(ast, { status: "ready" })).toBe(true);
  expect(applyFilter(ast, { status: "failed" })).toBe(false);
});
