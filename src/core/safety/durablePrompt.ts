/**
 * Durable permission prompt store per spec §4.6.
 *
 * Stage 5 ships an in-memory implementation: enqueueRequest stores a pending
 * request, setResponse records the user's decision, and waitForResponse polls
 * until either a response arrives or the timeout (10 min default) elapses.
 *
 * Stage 8 will swap the backing store for the JSONL ledger so prompts survive
 * a React unmount/remount (the original durability requirement). The public
 * shape stays the same so consumers don't have to change.
 */

export interface PermissionRequest {
  request_id: string;
  inv: { tool: string; input: Record<string, unknown> };
  suggested_pattern: string;
  available_scopes: ("once" | "session" | "always")[];
  created_at: number;
}

export interface PermissionResponse {
  request_id: string;
  decision: "allow" | "deny";
  scope?: "once" | "session" | "always";
  /** The pattern the user actually approved — may differ from suggested. */
  pattern?: string;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per spec.
const DEFAULT_POLL_MS = 100;

export class DurablePromptStore {
  private pending = new Map<string, PermissionRequest>();
  private responses = new Map<string, PermissionResponse>();

  enqueueRequest(req: PermissionRequest): void {
    this.pending.set(req.request_id, req);
  }

  setResponse(resp: PermissionResponse): void {
    this.responses.set(resp.request_id, resp);
  }

  async waitForResponse(
    request_id: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    pollMs: number = DEFAULT_POLL_MS,
  ): Promise<PermissionResponse | null> {
    const deadline = Date.now() + timeoutMs;
    // Fast path: response already present.
    const immediate = this.responses.get(request_id);
    if (immediate) return immediate;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      const r = this.responses.get(request_id);
      if (r) return r;
    }
    return null;
  }

  listPending(): PermissionRequest[] {
    return Array.from(this.pending.values());
  }
}
