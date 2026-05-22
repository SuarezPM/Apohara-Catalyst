import { test, expect } from "bun:test";
import { resolveWidget, listRegisteredTools } from "../../src/components/ToolWidgets/registry.js";
import { EditWidget } from "../../src/components/ToolWidgets/EditWidget.js";
import { BashWidget } from "../../src/components/ToolWidgets/BashWidget.js";
import { LedgerReadWidget } from "../../src/components/ToolWidgets/LedgerReadWidget.js";
import { GenericJsonWidget } from "../../src/components/ToolWidgets/GenericJsonWidget.js";

test("Edit/Write/MultiEdit all resolve to EditWidget", () => {
  expect(resolveWidget("Edit")).toBe(EditWidget);
  expect(resolveWidget("Write")).toBe(EditWidget);
  expect(resolveWidget("MultiEdit")).toBe(EditWidget);
});

test("Bash resolves to BashWidget", () => {
  expect(resolveWidget("Bash")).toBe(BashWidget);
});

test("apohara ledger tools resolve to LedgerReadWidget", () => {
  expect(resolveWidget("mcp__apohara__read_ledger")).toBe(LedgerReadWidget);
  expect(resolveWidget("mcp__apohara__list_runs")).toBe(LedgerReadWidget);
});

test("unknown tool falls back to GenericJsonWidget", () => {
  expect(resolveWidget("WeirdNewTool")).toBe(GenericJsonWidget);
  expect(resolveWidget("mcp__unknown__foo")).toBe(GenericJsonWidget);
});

test("listRegisteredTools returns 6 entries", () => {
  expect(listRegisteredTools().length).toBe(6);
});