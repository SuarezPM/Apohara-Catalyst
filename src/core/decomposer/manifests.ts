/**
 * Decomposer manifest types per spec §3.3.
 */

export interface SymbolRef {
  file: string;
  symbol: string;
  kind: "function" | "class" | "type" | "module" | "constant" | "trait" | "enum" | "other";
}

export interface TaskSymbolManifest {
  reads: SymbolRef[];
  writes: SymbolRef[];
  renames: SymbolRef[];
}

export interface RawTask {
  id: string;
  description: string;
  dependsOn: string[];
  agentRole: "planner" | "coder" | "critic" | "judge" | "explorer" | "editor";
  symbols: TaskSymbolManifest;
}

export function parseTaskWithManifest(raw: unknown): RawTask {
  if (typeof raw !== "object" || raw === null) throw new Error("task must be object");
  const t = raw as Partial<RawTask>;
  if (typeof t.id !== "string") throw new Error("task.id must be string");
  if (typeof t.description !== "string") throw new Error("task.description must be string");
  if (!Array.isArray(t.dependsOn)) throw new Error("task.dependsOn must be array");
  if (typeof t.agentRole !== "string") throw new Error("task.agentRole must be string");
  const manifestResult = validateManifest(t.symbols);
  if (!manifestResult.ok) throw new Error(`task.symbols: ${manifestResult.reason}`);
  return t as RawTask;
}

export interface ManifestValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateManifest(symbols: unknown): ManifestValidationResult {
  if (typeof symbols !== "object" || symbols === null) return { ok: false, reason: "symbols must be object" };
  const s = symbols as Partial<TaskSymbolManifest>;
  if (!Array.isArray(s.reads)) return { ok: false, reason: "reads must be array" };
  if (!Array.isArray(s.writes)) return { ok: false, reason: "writes must be array" };
  if (!Array.isArray(s.renames)) return { ok: false, reason: "renames must be array" };
  return { ok: true };
}