import { Command } from "cmdk";
import { FC, useEffect, useState, CSSProperties } from "react";

interface PaletteAction {
  id: string;
  label: string;
  run: () => void;
}

const DEFAULT_ACTIONS: PaletteAction[] = [
  { id: "task-new",      label: "New task",                run: () => console.log("[CommandPalette] new task") },
  { id: "view-board",    label: "Switch to Board view",    run: () => console.log("[CommandPalette] board") },
  { id: "view-kanban",   label: "Switch to Kanban view",   run: () => console.log("[CommandPalette] kanban") },
  { id: "view-plans",    label: "Open Plans panel",        run: () => console.log("[CommandPalette] plans") },
  { id: "doctor",        label: "Run apohara doctor",      run: () => console.log("[CommandPalette] doctor") },
  { id: "verify-setup",  label: "Run verify-setup",        run: () => console.log("[CommandPalette] verify-setup") },
];

interface Props {
  actions?: PaletteAction[];
}

const wrapperStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  paddingTop: 128,
  background: "rgba(0,0,0,0.6)",
  zIndex: 2500,
};

const contentStyle: CSSProperties = {
  background: "var(--apohara-dark-2)",
  border: "2px solid var(--apohara-lime)",
  borderRadius: 0,
  width: 480,
  padding: 8,
  fontFamily: "var(--font-mono)",
  color: "var(--apohara-bone)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid var(--border)",
  padding: "8px 12px",
  color: "var(--apohara-bone)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  outline: "none",
};

const itemStyle: CSSProperties = {
  padding: "8px 12px",
  cursor: "pointer",
  fontSize: 12,
};

export const CommandPalette: FC<Props> = ({ actions = DEFAULT_ACTIONS }) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (!open) return null;

  return (
    <div
      style={wrapperStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
      data-testid="command-palette"
    >
      <Command style={contentStyle} label="Command palette">
        <Command.Input
          autoFocus
          placeholder="Type a command…"
          style={inputStyle}
        />
        <Command.List>
          <Command.Empty style={{ padding: 8, opacity: 0.6 }}>No matches.</Command.Empty>
          {actions.map((a) => (
            <Command.Item
              key={a.id}
              value={a.id + " " + a.label}
              onSelect={() => {
                a.run();
                setOpen(false);
              }}
              style={itemStyle}
            >
              {a.label}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  );
};

export default CommandPalette;
