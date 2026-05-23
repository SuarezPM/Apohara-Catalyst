/**
 * Multi-turn session helper per spec §4.5 (nimbalyst #1.6).
 *
 * Sits on top of `AgentProtocol.appendToStdin` (G5.A.1) to give callers
 * a one-call `addTurn(protocol, sid, content)` wrapper that:
 *   1. Appends the turn content + "\n" to the child's persistent stdin.
 *   2. Records the turn in an in-memory history with monotonically
 *      increasing `turnIndex`.
 *
 * Multi-turn is the foundation of follow-up prompts without re-spawning
 * the wrapped CLI — re-spawn costs auth + workspace setup + the
 * load-bearing CLI internal locks (see CLAUDE.md "claude CLI 120s hang").
 */
import type { AgentProtocol } from "./protocols/AgentProtocol";

export interface TurnEntry {
  turnIndex: number;
  content: string;
  recordedAt: number;
}

export class SessionTurnManager {
  private readonly bySession = new Map<string, TurnEntry[]>();

  recordTurn(sessionId: string, content: string): TurnEntry {
    const arr = this.bySession.get(sessionId) ?? [];
    const entry: TurnEntry = {
      turnIndex: arr.length,
      content,
      recordedAt: Date.now(),
    };
    arr.push(entry);
    this.bySession.set(sessionId, arr);
    return entry;
  }

  async addTurn(
    protocol: AgentProtocol,
    sessionId: string,
    content: string,
  ): Promise<TurnEntry> {
    // The "\n" terminator is what tells the wrapped CLI the input line is
    // complete. Some CLIs (e.g. claude --print) require it before they
    // start streaming the response.
    await protocol.appendToStdin(sessionId, content + "\n");
    return this.recordTurn(sessionId, content);
  }

  turnCount(sessionId: string): number {
    return this.bySession.get(sessionId)?.length ?? 0;
  }

  history(sessionId: string): readonly TurnEntry[] {
    return [...(this.bySession.get(sessionId) ?? [])];
  }

  reset(sessionId: string): void {
    this.bySession.delete(sessionId);
  }
}
