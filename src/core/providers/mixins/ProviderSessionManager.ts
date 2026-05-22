/**
 * Maps Apohara session ids to provider-native session ids per spec §4.5
 * (nimbalyst #1.1 inspiration). Centralizes the bookkeeping so providers
 * don't drift in how they store this mapping.
 */

export interface SessionInfo {
  providerId: string;
  taskId?: string;
  paneKey?: string;
}

export class ProviderSessionManager {
  private map = new Map<string, SessionInfo>();

  set(apoharaSessionId: string, info: SessionInfo): void {
    this.map.set(apoharaSessionId, info);
  }

  get(apoharaSessionId: string): SessionInfo | undefined {
    return this.map.get(apoharaSessionId);
  }

  toProviderId(apoharaSessionId: string): string {
    const info = this.map.get(apoharaSessionId);
    if (!info) throw new Error(`no provider session for ${apoharaSessionId}`);
    return info.providerId;
  }

  toTaskId(apoharaSessionId: string): string | undefined {
    return this.map.get(apoharaSessionId)?.taskId;
  }

  delete(apoharaSessionId: string): void {
    this.map.delete(apoharaSessionId);
  }

  listAll(): Array<{ apoharaSessionId: string; info: SessionInfo }> {
    return Array.from(this.map, ([apoharaSessionId, info]) => ({ apoharaSessionId, info }));
  }
}
