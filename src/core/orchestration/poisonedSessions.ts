/**
 * Detect sessions with structural corruption that would crash the dispatcher
 * if loaded normally. multica's poisoned-session quarantine pattern.
 */

export interface SessionLike {
  id: string;
  messages: Array<{
    role: string;
    content: string;
    tool_use_id?: string;
    parent_tool_use_id?: string;
  }>;
}

export function detectPoisonedSession(session: SessionLike): boolean {
  for (const msg of session.messages) {
    // Heuristic 1: assistant message claims to be JSON but doesn't parse.
    if (msg.role === "assistant" && msg.content.trim().startsWith("{")) {
      try {
        JSON.parse(msg.content);
      } catch {
        return true;
      }
    }
  }

  // Heuristic 2: cycle in tool_use parent chain.
  const parentOf = new Map<string, string>();
  for (const msg of session.messages) {
    if (msg.tool_use_id && msg.parent_tool_use_id) {
      parentOf.set(msg.tool_use_id, msg.parent_tool_use_id);
    }
  }
  for (const [start] of parentOf.entries()) {
    const seen = new Set<string>();
    let cur: string | undefined = start;
    while (cur) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  }

  return false;
}

export function quarantineSession(session: SessionLike): string {
  // Returns the target archive path. Caller writes the actual file.
  // Sanitize session.id against path traversal — strip slashes, dots,
  // null bytes. A caller passing `../../etc/passwd` as session.id would
  // otherwise escape the quarantine dir. Defensive: callers should
  // already validate, but quarantine is a security boundary.
  const safeId = session.id.replace(/[\/\\.\0]/g, "_") || "anon";
  return `quarantine/${safeId}-${Date.now()}.json`;
}
