import { atom } from "jotai/vanilla";

export type PermissionScope = "once" | "session" | "always";

export interface PermissionRequestEvent {
  request_id: string;
  tool: string;
  input: Record<string, unknown>;
  suggested_pattern: string;
  available_scopes: PermissionScope[];
  ts: number;
}

export interface PermissionResponseEvent {
  request_id: string;
  decision: "allow" | "deny";
  scope?: PermissionScope;
  pattern?: string;
  ts: number;
}

/** Map request_id → request event (active prompts) */
export const pendingPermissionRequestsAtom = atom<Record<string, PermissionRequestEvent>>({});

/** Map request_id → response event (resolved prompts) */
export const permissionResponsesAtom = atom<Record<string, PermissionResponseEvent>>({});

/** Derived: requests that have NOT yet received a response */
export const unresolvedPermissionRequestsAtom = atom((get) => {
  const requests = get(pendingPermissionRequestsAtom);
  const responses = get(permissionResponsesAtom);
  return Object.values(requests).filter((r) => !(r.request_id in responses));
});

export const enqueuePermissionRequestAtom = atom(null, (get, set, req: PermissionRequestEvent) => {
  const current = get(pendingPermissionRequestsAtom);
  set(pendingPermissionRequestsAtom, { ...current, [req.request_id]: req });
});

export const recordPermissionResponseAtom = atom(null, (get, set, resp: PermissionResponseEvent) => {
  const current = get(permissionResponsesAtom);
  set(permissionResponsesAtom, { ...current, [resp.request_id]: resp });
});