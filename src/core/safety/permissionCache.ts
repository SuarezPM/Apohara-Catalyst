/**
 * Session-scoped permission cache per spec §4.6.
 *
 * When the user approves a permission with scope="session", the pattern lives
 * here until the session ends (or until clear() is called explicitly). Patterns
 * approved with scope="always" go to the settings file instead (handled by the
 * caller). Patterns approved with scope="once" never touch this cache.
 *
 * Memory-bounded by number of live sessions × patterns-per-session.
 */

export class PermissionCache {
  private cache = new Map<string, Set<string>>();

  add(sessionId: string, pattern: string): void {
    let set = this.cache.get(sessionId);
    if (!set) {
      set = new Set();
      this.cache.set(sessionId, set);
    }
    set.add(pattern);
  }

  has(sessionId: string, pattern: string): boolean {
    return this.cache.get(sessionId)?.has(pattern) ?? false;
  }

  list(sessionId: string): string[] {
    const set = this.cache.get(sessionId);
    return set ? Array.from(set) : [];
  }

  clear(sessionId: string): void {
    this.cache.delete(sessionId);
  }
}
