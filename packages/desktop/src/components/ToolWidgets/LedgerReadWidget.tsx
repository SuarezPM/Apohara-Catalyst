import type { ToolInvocationView } from "./registry.js";

export function LedgerReadWidget({ inv }: { inv: ToolInvocationView }) {
  const rows = Array.isArray(inv.output) ? inv.output : [];
  return (
    <div data-testid="ledger-read-widget" style={{ border: "1px solid #30363d", borderRadius: 4, background: "#161b22", padding: "0.5rem" }}>
      <header style={{ color: "#58a6ff", marginBottom: "0.4rem", fontSize: "0.8rem" }}>
        📒 {inv.tool} — {rows.length} rows
      </header>
      <div style={{ maxHeight: 300, overflowY: "auto", fontSize: "0.75rem" }}>
        {rows.slice(0, 50).map((row, idx) => (
          <div key={idx} style={{ padding: "0.2rem 0.3rem", borderBottom: "1px solid #21262d", color: "#e6edf3", fontFamily: "monospace" }}>
            {typeof row === "object" && row !== null ? JSON.stringify(row) : String(row)}
          </div>
        ))}
        {rows.length > 50 && (
          <div style={{ padding: "0.3rem", color: "#6e7681", fontStyle: "italic" }}>
            +{rows.length - 50} more rows
          </div>
        )}
      </div>
    </div>
  );
}