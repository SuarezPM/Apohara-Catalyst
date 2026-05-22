import type { ToolInvocationView } from "./registry.js";

export function EditWidget({ inv }: { inv: ToolInvocationView }) {
  const path = typeof inv.input.file_path === "string" ? inv.input.file_path : "(unknown path)";
  return (
    <div data-testid="edit-widget" style={{ border: "1px solid #30363d", borderRadius: 4, background: "#161b22", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.8rem" }}>
      <header style={{ color: "#58a6ff", marginBottom: "0.4rem" }}>
        ✏️ {inv.tool}: {path}
      </header>
      <div style={{ color: "#8b949e", fontSize: "0.7rem" }}>
        [Monaco diff renders here in Stage 7.x integration — Task 7.11 ships the registry slot]
      </div>
    </div>
  );
}