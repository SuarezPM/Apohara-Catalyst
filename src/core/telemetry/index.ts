/**
 * Privacy-first telemetry per spec §0.33.
 *
 * - Allowlist of event types (closed vocabulary, no free strings).
 * - Denylist of property keys (PII, secrets, file paths, source code).
 * - Failure categories normalized to small enums.
 * - Opt-out via APOHARA_TELEMETRY_DISABLED=1.
 * - Anonymous install ID, no user identifiers.
 */

export { getOrCreateInstallId } from "./install-id";

export const ALLOWED_EVENTS = [
  "init_started",
  "init_completed",
  "provider_connect_started",
  "provider_connect_succeeded",
  "provider_connect_failed",
  "doctor_started",
  "doctor_passed",
  "doctor_failed",
  "agent_spawn",
  "task_assigned",
  "task_completed",
  "task_failed",
  "task_blocked",
  "pr_opened",
  "release_promoted",
] as const;

export type AllowedEvent = typeof ALLOWED_EVENTS[number];

const ALLOWED = new Set<string>(ALLOWED_EVENTS);

export function isAllowedEvent(event: string): event is AllowedEvent {
  return ALLOWED.has(event);
}

const DENY_KEYS = new Set([
  "repo_url", "repo_slug", "repo_name",
  "username", "user_email", "user_login",
  "email", "user_id", "userid", "user", "account_id",
  "file_path", "file_paths", "files",
  "source_code", "source_code_diff", "diff", "patch",
  "prompt", "prompt_body",
  "logs", "log_lines",
  "raw_payload", "payload",
  "secret", "token", "api_key", "private_key",
  "branch_name", "commit_sha", "commit_message",
  "issue_title", "issue_body", "pr_title", "pr_body",
]);

/** Per-string max length sent to transport. Prevents unbounded payloads if a caller
 *  passes a large stack trace, log dump, or error message under a non-deny key. */
const MAX_STRING_LENGTH = 200;

export function scrubProperties(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (DENY_KEYS.has(k.toLowerCase())) continue;
    if (typeof v === "string") {
      out[k] = v.length > MAX_STRING_LENGTH ? v.slice(0, MAX_STRING_LENGTH) + "…" : v;
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
    // Drop objects/arrays — bound the surface
  }
  return out;
}

export interface TelemetryRecord {
  event: AllowedEvent;
  properties: Record<string, unknown>;
  installId: string;
  ts: number;
}

export interface TelemetryTransport {
  (record: TelemetryRecord): Promise<void>;
}

export class TelemetrySink {
  private enabled: boolean;
  private installId: string;
  private transport: TelemetryTransport;

  constructor(opts: { enabled: boolean; installId: string; transport: TelemetryTransport }) {
    const envDisabled = process.env.APOHARA_TELEMETRY_DISABLED === "1";
    this.enabled = opts.enabled && !envDisabled;
    this.installId = opts.installId;
    this.transport = opts.transport;
  }

  async record(event: string, properties: Record<string, unknown>): Promise<void> {
    if (!this.enabled) return;
    if (!isAllowedEvent(event)) return;
    await this.transport({
      event,
      properties: scrubProperties(properties),
      installId: this.installId,
      ts: Date.now(),
    });
  }
}
