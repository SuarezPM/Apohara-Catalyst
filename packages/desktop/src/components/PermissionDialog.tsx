import { useAtomValue, useSetAtom } from "jotai/react";
import { unresolvedPermissionRequestsAtom, recordPermissionResponseAtom, type PermissionScope } from "../store/permissionStore.js";

interface PermissionDialogProps {
  /** Emitted when user clicks allow/deny; Stage 8 wires this to ledger writer */
  onUserDecision?(req: { request_id: string; decision: "allow" | "deny"; scope?: PermissionScope; pattern?: string }): void;
}

export function PermissionDialog({ onUserDecision }: PermissionDialogProps) {
  const unresolved = useAtomValue(unresolvedPermissionRequestsAtom);
  const recordResponse = useSetAtom(recordPermissionResponseAtom);

  if (unresolved.length === 0) return null;
  const current = unresolved[0];

  const decide = (decision: "allow" | "deny", scope?: PermissionScope) => {
    const resp = {
      request_id: current.request_id,
      decision,
      scope,
      pattern: current.suggested_pattern,
      ts: Date.now(),
    };
    recordResponse(resp);
    onUserDecision?.(resp);
  };

  return (
    <div
      data-testid="permission-dialog"
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 2000,
      }}
    >
      <div style={{ background: "#161b22", color: "#e6edf3", border: "1px solid #30363d", borderRadius: 6, padding: "1.5rem", width: 480, maxWidth: "90vw" }}>
        <h2 style={{ margin: 0, fontSize: "1rem", color: "#d29922" }}>Permission requested</h2>
        <div data-testid="dialog-tool" style={{ marginTop: "0.5rem", fontFamily: "monospace", fontSize: "0.9rem" }}>
          {current.tool}
        </div>
        <div data-testid="dialog-input" style={{ marginTop: "0.4rem", padding: "0.5rem", background: "#0d1117", border: "1px solid #21262d", borderRadius: 4, fontFamily: "monospace", fontSize: "0.75rem", maxHeight: 160, overflowY: "auto", whiteSpace: "pre-wrap" }}>
          {JSON.stringify(current.input, null, 2)}
        </div>
        <div data-testid="dialog-pattern" style={{ marginTop: "0.4rem", fontSize: "0.8rem", color: "#8b949e" }}>
          Suggested pattern: <code style={{ color: "#58a6ff" }}>{current.suggested_pattern}</code>
        </div>

        <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {current.available_scopes.map((scope) => (
            <button
              key={scope}
              data-testid={`dialog-allow-${scope}`}
              onClick={() => decide("allow", scope)}
              style={{ padding: "0.4rem 0.8rem", background: "#1f6feb", color: "white", border: "none", borderRadius: 4, cursor: "pointer", fontSize: "0.8rem" }}
            >
              Allow {scope}
            </button>
          ))}
          <button
            data-testid="dialog-deny"
            onClick={() => decide("deny")}
            style={{ padding: "0.4rem 0.8rem", background: "transparent", color: "#f85149", border: "1px solid #f85149", borderRadius: 4, cursor: "pointer", fontSize: "0.8rem", marginLeft: "auto" }}
          >
            Deny
          </button>
        </div>

        {unresolved.length > 1 && (
          <div style={{ marginTop: "0.6rem", fontSize: "0.7rem", color: "#8b949e", textAlign: "right" }}>
            +{unresolved.length - 1} more pending
          </div>
        )}
      </div>
    </div>
  );
}