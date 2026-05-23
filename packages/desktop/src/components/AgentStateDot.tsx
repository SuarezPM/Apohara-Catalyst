import { FC, CSSProperties } from "react";

export type AgentState = "idle" | "working" | "waiting" | "done" | "error";

interface Props {
  state: AgentState;
  size?: "sm" | "md";
  label?: string;
}

const SIZE_PX = { sm: 8, md: 12 } as const;

const STATE_BG: Record<AgentState, string> = {
  idle:    "var(--text-muted)",
  working: "var(--apohara-lime)",
  waiting: "rgba(237, 239, 240, 0.4)",
  done:    "var(--apohara-lime)",
  error:   "var(--apohara-red)",
};

const PULSE_KEYFRAMES = "agent-state-dot-pulse";

// Inject keyframes once via a style tag the first time this module loads.
// Avoids requiring index.css changes for a single component.
if (typeof document !== "undefined" && !document.getElementById("agent-state-dot-styles")) {
  const style = document.createElement("style");
  style.id = "agent-state-dot-styles";
  style.textContent = `
    @keyframes ${PULSE_KEYFRAMES} {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  `;
  document.head.appendChild(style);
}

export const AgentStateDot: FC<Props> = ({ state, size = "md", label }) => {
  const px = SIZE_PX[size];
  const style: CSSProperties = {
    display: "inline-block",
    width: px,
    height: px,
    background: STATE_BG[state],
    borderRadius: 0, // pixel-art aesthetic
  };
  if (state === "working") {
    style.animation = `${PULSE_KEYFRAMES} 1.5s ease-in-out infinite`;
  }
  return (
    <span
      data-state-dot
      data-state={state}
      role="status"
      aria-label={label ?? `agent ${state}`}
      style={style}
    />
  );
};

export default AgentStateDot;
