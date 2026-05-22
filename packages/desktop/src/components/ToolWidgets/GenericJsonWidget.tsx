import type { ToolInvocationView } from "./registry.js";

export function GenericJsonWidget({ inv }: { inv: ToolInvocationView }) {
  return (
    <div data-testid="generic-json-widget" style={{ border: "1px solid #30363d", borderRadius: 4, background: "#161b22", padding: "0.5rem" }}>
      <header style={{ color: "#8b949e", marginBottom: "0.3rem", fontSize: "0.8rem" }}>
        {inv.tool}
      </header>
      <pre style={{ color: "#e6edf3", fontSize: "0.7rem", margin: 0, whiteSpace: "pre-wrap", maxHeight: 240, overflowY: "auto" }}>
        input: {JSON.stringify(inv.input, null, 2)}
        {inv.output !== undefined && "\noutput: " + JSON.stringify(inv.output, null, 2)}
      </pre>
    </div>
  );
}