import { useAtomValue } from "jotai/react";
import { agentConfigAtom, anyRunActiveAtom, type AgentConfigEntry } from "../store/agentConfigStore.js";

const ICON: Record<AgentConfigEntry["providerId"], string> = {
  "claude-code-cli": "🤖",
  "codex-cli": "🧑‍💻",
  "opencode-go": "🚀",
};

export function AgentConfigPanel() {
  const configs = Object.values(useAtomValue(agentConfigAtom));
  const editMode = !useAtomValue(anyRunActiveAtom);

  return (
    <aside
      data-testid="agent-config-panel"
      style={{
        width: 320,
        background: "#0d1117",
        borderLeft: "1px solid #30363d",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        color: "#e6edf3",
      }}
    >
      <header style={{ padding: "0.75rem", borderBottom: "1px solid #30363d", fontWeight: 600, fontSize: "0.85rem", display: "flex", justifyContent: "space-between" }}>
        <span>Agents</span>
        <span data-testid="edit-mode-indicator" style={{ fontSize: "0.7rem", color: editMode ? "#3fb950" : "#d29922" }}>
          {editMode ? "edit" : "locked (run active)"}
        </span>
      </header>
      <div style={{ flex: 1, overflowY: "auto", padding: "0.5rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {configs.map((c) => (
          <article
            key={c.providerId}
            data-testid={`agent-card-${c.providerId}`}
            style={{ padding: "0.6rem", background: "#161b22", border: "1px solid #30363d", borderRadius: 4, fontSize: "0.8rem" }}
          >
            <header style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.4rem" }}>
              <span>{ICON[c.providerId]}</span>
              <span style={{ fontWeight: 600, flex: 1 }}>{c.displayName}</span>
            </header>
            <div style={{ fontSize: "0.7rem", color: "#8b949e" }}>
              roles: {c.roles.join(", ")}
            </div>
            <div style={{ fontSize: "0.7rem", color: "#8b949e", marginTop: "0.2rem" }}>
              capabilities: {c.capabilities.length}
            </div>
            <div style={{ fontSize: "0.7rem", color: "#8b949e", marginTop: "0.2rem" }}>
              permissions: {c.permissions.length}
            </div>
            {c.mcpServers.length > 0 && (
              <div style={{ marginTop: "0.4rem", fontSize: "0.7rem" }}>
                MCP: {c.mcpServers.map((m) => (
                  <span key={m.name} title={m.status} style={{ marginRight: 4, color: m.status === "connected" ? "#3fb950" : m.status === "error" ? "#f85149" : "#6e7681" }}>
                    {m.name}
                  </span>
                ))}
              </div>
            )}
          </article>
        ))}
        {configs.length === 0 && (
          <div style={{ color: "#6e7681", textAlign: "center", padding: "1rem", fontSize: "0.85rem" }}>
            No agents configured yet.
          </div>
        )}
      </div>
    </aside>
  );
}