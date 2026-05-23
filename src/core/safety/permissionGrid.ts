/**
 * chorus H10 (resolved AMBIGUO) — explicit per-(scope, resource)
 * permission grid.
 *
 * Three scopes ("once" / "session" / "always") cross N resource
 * patterns. The UI renders it as a table; the underlying storage is
 * flat so export and replay are trivial. The same resource pattern in
 * different scopes is independent — `cmd.exec.git` allowed once but
 * denied for the session is a coherent and supported configuration.
 *
 * Setting state="unset" is equivalent to clearing the cell so callers
 * do not have to know whether a cell was previously set. `get` always
 * returns a non-null `PermissionState` ("unset" when no row exists).
 */

export type PermissionScope = "once" | "session" | "always";
export type PermissionState = "allow" | "deny" | "unset";

export interface PermissionRow {
  scope: PermissionScope;
  resource: string;
  state: PermissionState;
}

export class PermissionGrid {
  private rows = new Map<string, PermissionState>();

  private key(scope: PermissionScope, resource: string): string {
    return `${scope}::${resource}`;
  }

  set(
    scope: PermissionScope,
    resource: string,
    state: PermissionState,
  ): void {
    if (state === "unset") {
      this.rows.delete(this.key(scope, resource));
    } else {
      this.rows.set(this.key(scope, resource), state);
    }
  }

  get(scope: PermissionScope, resource: string): PermissionState {
    return this.rows.get(this.key(scope, resource)) ?? "unset";
  }

  exportRows(): PermissionRow[] {
    const out: PermissionRow[] = [];
    for (const [k, state] of this.rows) {
      // Resource may contain "::" so we split on the FIRST occurrence only.
      const sep = k.indexOf("::");
      const scope = k.slice(0, sep) as PermissionScope;
      const resource = k.slice(sep + 2);
      out.push({ scope, resource, state });
    }
    return out;
  }
}
