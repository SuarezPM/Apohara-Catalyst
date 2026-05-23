/**
 * Redactor wrapper for crash reports (spec §0.33).
 *
 * Crash reports embed `message`, `stack`, and arbitrary `context` values
 * that may contain stray API keys / tokens (sanitizeEnv at the spawn
 * boundary catches them going *out*, but a crash captured from inside
 * the parent process can still see env values in scope). This wrapper
 * applies the existing G5.H.1 `redactSecrets` regex sweep over every
 * string in the report — recursively for nested context objects —
 * before persistence (JSONL) or display (the "Send to Apohara" UI).
 *
 * Defense-in-depth, not a substitute for §0.4: a redacted log is the
 * last-line guard if a secret somehow reaches an error frame.
 */
import { redactSecrets } from "../logging/secretRedactor";
import type { CrashReport } from "./jsonl";

export function redactCrashReport(r: CrashReport): CrashReport {
  return {
    ...r,
    message: redactSecrets(r.message),
    stack: redactSecrets(r.stack),
    context: redactContextValues(r.context),
  };
}

function redactContextValues(
  ctx: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (typeof v === "string") {
      out[k] = redactSecrets(v);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        typeof item === "string"
          ? redactSecrets(item)
          : item && typeof item === "object"
            ? redactContextValues(item as Record<string, unknown>)
            : item,
      );
    } else if (v && typeof v === "object") {
      out[k] = redactContextValues(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}
