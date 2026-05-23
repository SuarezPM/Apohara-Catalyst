/**
 * chorus H6 — post-spawn cheap detection of hallucinations.
 *
 * Two classes of red flags caught here:
 *   1. Imports of relative modules that do not resolve on disk.
 *   2. Calls to identifiers that are not in the `definedSymbols` set
 *      (when provided).
 *
 * Heuristic only — full type-checking is `tsc --noEmit`; this exists
 * to provide a fast red-flag signal to the critic role before invoking
 * the expensive tooling. False negatives are acceptable; false positives
 * should be rare so the critic does not learn to ignore the signal.
 *
 * Notes on the regex layer:
 *   - The import regex captures the module specifier from
 *     `import ... from "spec"`, `import "spec"`, both single and double
 *     quotes.
 *   - The call regex matches `Identifier(` calls. `import(` and
 *     `require(` are explicitly excluded — they are syntax/builtin,
 *     not "symbols a user might fail to define."
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface DetectArgs {
  code: string;
  existingFiles: string[];
  workspacePath: string;
  /**
   * When provided, the detector flags calls to any identifier not in
   * this set. When omitted, the symbol-call branch is skipped (so
   * callers that only want import-resolution checks do not need a
   * symbol table).
   */
  definedSymbols?: Set<string>;
}

export interface DetectResult {
  hallucinations: string[];
}

export function detectHallucinations(args: DetectArgs): DetectResult {
  const out: string[] = [];

  // ---- 1. Imports of relative paths -------------------------------------
  const importRe =
    /import\s+(?:[\w*{},\s]+?\s+from\s+)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(args.code))) {
    const spec = m[1];
    if (!spec.startsWith(".")) continue;

    const candidates = [
      resolve(args.workspacePath, spec),
      resolve(args.workspacePath, spec + ".ts"),
      resolve(args.workspacePath, spec + ".tsx"),
      resolve(args.workspacePath, spec + ".js"),
      resolve(args.workspacePath, spec + ".mjs"),
      resolve(args.workspacePath, spec, "index.ts"),
      resolve(args.workspacePath, spec, "index.js"),
    ];
    const isReal =
      args.existingFiles.some(f => candidates.includes(f)) ||
      candidates.some(c => existsSync(c));
    if (!isReal) out.push(spec);
  }

  // ---- 2. Undefined symbol calls ----------------------------------------
  // Skip member-access calls (`obj.method(`) — we only check the
  // root-binding side. The lookbehind `(?<![.\w])` rejects matches
  // preceded by `.` (member access) or another word character (which
  // would mean we are inside an identifier, not at its start).
  if (args.definedSymbols) {
    const callRe = /(?<![.\w])([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    while ((m = callRe.exec(args.code))) {
      const sym = m[1];
      if (sym === "import" || sym === "require") continue;
      if (!args.definedSymbols.has(sym)) out.push(sym);
    }
  }

  return { hallucinations: out };
}
