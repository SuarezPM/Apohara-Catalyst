import type { ToolInvocationView } from "./registry.js";

export function BashWidget({ inv }: { inv: ToolInvocationView }) {
  const cmd = typeof inv.input.command === "string" ? inv.input.command : "";
  const output = typeof inv.output === "string" ? inv.output : inv.output ? JSON.stringify(inv.output, null, 2) : "";

  return (
    <div data-testid="bash-widget" style={{ background: "#010409", border: "1px solid #30363d", borderRadius: 4, padding: "0.5rem", fontFamily: "monospace", fontSize: "0.8rem" }}>
      <div style={{ color: "#3fb950", marginBottom: "0.3rem" }}>
        $ {cmd}
      </div>
      {output && (
        <pre style={{ color: "#e6edf3", margin: 0, whiteSpace: "pre-wrap", maxHeight: 300, overflowY: "auto" }}>
          {output}
        </pre>
      )}
    </div>
  );
}