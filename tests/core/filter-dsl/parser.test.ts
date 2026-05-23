import { expect, test } from "bun:test";
import { parseFilter, type FilterAST } from "../../../src/core/filter-dsl/parser";

test("parses simple equality predicate", () => {
  const ast = parseFilter('status == "ready"');
  expect(ast).toEqual({
    op: "eq",
    field: "status",
    value: "ready",
  });
});

test("parses AND of two predicates", () => {
  const ast = parseFilter('status == "ready" && cost < 0.5');
  expect(ast.op).toBe("and");
});

test("parses negation", () => {
  const ast = parseFilter('!(status == "failed")');
  expect(ast.op).toBe("not");
});

test("rejects malformed input", () => {
  expect(() => parseFilter("status ==")).toThrow(/parse/);
});
