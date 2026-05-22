import { useAtomValue, useSetAtom } from "jotai/react";
import { viewModeAtom, setViewModeAtom, type ViewMode } from "../store/viewStore.js";

const VIEWS: { key: ViewMode; label: string; icon: string }[] = [
  { key: "graph", label: "Graph", icon: "⊟" },
  { key: "board", label: "Board", icon: "▤" },
  { key: "terminal", label: "Terminal", icon: "⌨" },
];

export function ViewToggle() {
  const current = useAtomValue(viewModeAtom);
  const setView = useSetAtom(setViewModeAtom);

  return (
    <div
      data-testid="view-toggle"
      role="tablist"
      style={{
        display: "flex",
        gap: 2,
        background: "#161b22",
        border: "1px solid #30363d",
        borderRadius: 4,
        padding: 2,
      }}
    >
      {VIEWS.map((v) => {
        const active = v.key === current;
        return (
          <button
            key={v.key}
            data-testid={`view-toggle-${v.key}`}
            role="tab"
            aria-selected={active}
            onClick={() => setView(v.key)}
            style={{
              padding: "0.3rem 0.6rem",
              background: active ? "#30363d" : "transparent",
              color: active ? "#e6edf3" : "#8b949e",
              border: "none",
              borderRadius: 3,
              cursor: "pointer",
              fontSize: "0.8rem",
              display: "flex",
              gap: "0.3rem",
              alignItems: "center",
            }}
          >
            <span aria-hidden>{v.icon}</span>
            <span>{v.label}</span>
          </button>
        );
      })}
    </div>
  );
}