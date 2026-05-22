/**
 * Custom tool widgets registry per spec §4 + nimbalyst #7.3.
 *
 * Maps tool names to React components. resolveWidget falls back to
 * GenericJsonWidget for unregistered tools. Auto-handles mcp__ prefix
 * (mcp__server__tool entries are resolved by server scope first then tool).
 */
import type { ComponentType } from "react";
import { EditWidget } from "./EditWidget.js";
import { BashWidget } from "./BashWidget.js";
import { LedgerReadWidget } from "./LedgerReadWidget.js";
import { GenericJsonWidget } from "./GenericJsonWidget.js";

export interface ToolInvocationView {
  tool: string;
  input: Record<string, unknown>;
  output?: unknown;
}

export type ToolWidget = ComponentType<{ inv: ToolInvocationView }>;

const REGISTRY: Record<string, ToolWidget> = {
  "Edit": EditWidget,
  "Write": EditWidget,           // shared widget
  "MultiEdit": EditWidget,
  "Bash": BashWidget,
  "mcp__apohara__read_ledger": LedgerReadWidget,
  "mcp__apohara__list_runs": LedgerReadWidget, // table view fits
};

export function resolveWidget(toolName: string): ToolWidget {
  return REGISTRY[toolName] ?? GenericJsonWidget;
}

export function listRegisteredTools(): string[] {
  return Object.keys(REGISTRY);
}