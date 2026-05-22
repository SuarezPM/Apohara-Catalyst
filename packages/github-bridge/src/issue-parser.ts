/**
 * Parses GitHub issue body → orchestration objective payload per spec §9.3.
 *
 * If issue body contains YAML frontmatter (--- ... ---) OR a '## SPEC' heading,
 * treats it as a structured SPEC.md and parses via planDocument-style logic.
 * Else falls back to plain parsing:
 *   - First paragraph = objective
 *   - Bullet lists in '## Acceptance Criteria' or '- [ ]' = acceptance items
 */
import { parse as parseYaml } from "yaml";

export interface ObjectivePayload {
  objective: string;
  acceptanceCriteria: { checked: boolean; text: string }[];
  context?: string;
  priority?: "urgent" | "high" | "normal" | "low";
}

export type ParseResult =
  | { kind: "objective"; payload: ObjectivePayload }
  | { kind: "ambiguous"; missing: string[] };

export function parseIssue(body: string): ParseResult {
  if (body.startsWith("---\n")) {
    const close = body.indexOf("\n---\n", 4);
    if (close !== -1) {
      try {
        const fm = (parseYaml(body.slice(4, close)) ?? {}) as Record<string, unknown>;
        const rest = body.slice(close + 5);
        return parseStructured(rest, fm);
      } catch {
        // fall through to plain
      }
    }
  }

  const specHeading = /^##\s+SPEC\s*$/m;
  if (specHeading.test(body)) {
    return parseStructured(body, {});
  }

  return parsePlain(body);
}

function parseStructured(body: string, fm: Record<string, unknown>): ParseResult {
  const sections = splitSections(body);
  const objective = (sections.get("Objective") ?? sections.get("SPEC") ?? "").trim();
  if (!objective) {
    return { kind: "ambiguous", missing: ["objective"] };
  }
  const acceptanceCriteria = parseChecklist(sections.get("Acceptance Criteria") ?? "");
  const context = (sections.get("Context") ?? "").trim() || undefined;
  const priority = typeof fm.priority === "string"
    ? (["urgent","high","normal","low"].includes(fm.priority) ? fm.priority as ObjectivePayload["priority"] : undefined)
    : undefined;
  return { kind: "objective", payload: { objective, acceptanceCriteria, context, priority } };
}

function parsePlain(body: string): ParseResult {
  const trimmed = body.trim();
  if (!trimmed) return { kind: "ambiguous", missing: ["body is empty"] };

  const firstPara = trimmed.split(/\n\s*\n/)[0].trim();
  if (!firstPara) return { kind: "ambiguous", missing: ["objective"] };

  const acceptanceCriteria = parseChecklist(trimmed);

  return { kind: "objective", payload: { objective: firstPara, acceptanceCriteria } };
}

function splitSections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = body.split("\n");
  let current: string | null = null;
  let buf: string[] = [];
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (current) out.set(current, buf.join("\n"));
      current = m[1].trim();
      buf = [];
    } else if (current) {
      buf.push(line);
    }
  }
  if (current) out.set(current, buf.join("\n"));
  return out;
}

function parseChecklist(body: string): { checked: boolean; text: string }[] {
  const items: { checked: boolean; text: string }[] = [];
  for (const line of body.split("\n")) {
    const m = line.match(/^\s*-\s*\[([ xX])\]\s+(.+?)\s*$/);
    if (m) items.push({ checked: m[1].toLowerCase() === "x", text: m[2].trim() });
  }
  return items;
}