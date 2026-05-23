/**
 * TerminalPane — xterm.js consumer for an embedded PTY.
 *
 * Props:
 *   - `ptyId` — already-spawned PTY id (from `POST /api/pty`).
 *   - `onClose` — called when the PTY exits / the user kills it.
 *   - `onOsc998` — optional callback fired for every parsed OSC 998
 *     command-state event. The PTY's bytes are stripped of the escape
 *     before they hit xterm so the visible terminal stays clean.
 *
 * Behavior:
 *   1. Mounts an `xterm.js` Terminal into the host div.
 *   2. Opens `GET /api/pty/:id/stream` SSE — the first `replay` event
 *      bootstraps the scrollback, subsequent `data` events stream
 *      live output.
 *   3. Keyboard input is POSTed back via `/api/pty/:id/input` as a
 *      plain text body (xterm.js delivers raw byte sequences from
 *      onData, including arrow-key VT escapes — perfect for the
 *      PTY's stdin).
 *   4. ResizeObserver wires fit-addon recomputes through
 *      `/api/pty/:id/resize`.
 *   5. G7.C.9 — Filters OSC 998 command-state sequences out of the
 *      visible stream (`createOsc998Parser`) and renders the most
 *      recent state in a small badge above the terminal. The parser
 *      is stateful (re-assembles partial chunks) so split frames
 *      across SSE chunks still parse correctly.
 *
 * No PTY is created here; callers (e.g. the dispatch flow) spawn
 * one and hand the id down. Keeping spawn and render apart means
 * the same component renders a PTY session that survives a tab
 * switch / re-attach.
 */
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {
	createOsc998Parser,
	type Osc998Event,
} from "../../../../src/core/pty/osc998.js";

export interface TerminalPaneProps {
	ptyId: string;
	onClose?: (exitCode: number | null) => void;
	onOsc998?: (event: Osc998Event) => void;
}

/**
 * Coerce an OSC 998 payload to a human-readable badge label.
 *
 * The known shapes from the three sanctioned drivers all follow the
 * `{ state: "running" | "idle" | "blocked", detail?: string }` skeleton,
 * but the parser tolerates anything (`payload: unknown`). When the shape
 * is unrecognized we fall back to a short JSON preview so the UI never
 * goes blank on a custom emitter.
 */
function badgeFor(event: Osc998Event): {
	text: string;
	color: string;
	bg: string;
} {
	const p = event.payload as { state?: unknown; detail?: unknown } | null;
	const state =
		p && typeof p === "object" && typeof p.state === "string"
			? (p.state as string).toLowerCase()
			: null;
	const detail =
		p && typeof p === "object" && typeof p.detail === "string"
			? (p.detail as string)
			: undefined;
	if (state === "running") {
		return {
			text: detail ? `▶ ${detail}` : "▶ running",
			color: "#3fb950",
			bg: "#0d2818",
		};
	}
	if (state === "idle" || state === "done" || state === "complete") {
		return {
			text: detail ? `✓ ${detail}` : "✓ idle",
			color: "#7d8590",
			bg: "#161b22",
		};
	}
	if (state === "blocked" || state === "error" || state === "failed") {
		return {
			text: detail ? `! ${detail}` : "! blocked",
			color: "#f85149",
			bg: "#2d1010",
		};
	}
	// Unknown / custom payload — short JSON preview, truncated to keep
	// the badge under one line.
	const preview = event.raw.length > 48 ? `${event.raw.slice(0, 45)}…` : event.raw;
	return { text: preview, color: "#d29922", bg: "#2d2510" };
}

export function TerminalPane({ ptyId, onClose, onOsc998 }: TerminalPaneProps) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const termRef = useRef<Terminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const parserRef = useRef(createOsc998Parser());
	const [lastOsc, setLastOsc] = useState<Osc998Event | null>(null);

	useEffect(() => {
		if (!hostRef.current) return;
		const term = new Terminal({
			fontFamily:
				"MesloLGM Nerd Font Mono, Menlo, Consolas, 'DejaVu Sans Mono', monospace",
			fontSize: 13,
			theme: {
				background: "#0c0c10",
				foreground: "#e6edf3",
				cursor: "#58a6ff",
			},
			cursorBlink: true,
			scrollback: 5000,
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.open(hostRef.current);
		fit.fit();
		termRef.current = term;
		fitRef.current = fit;

		// Send keystrokes to the PTY. xterm.js onData() emits the raw
		// byte sequences (including arrow keys as VT escapes), exactly
		// what the PTY's stdin wants.
		const onData = term.onData((data) => {
			fetch(`/api/pty/${encodeURIComponent(ptyId)}/input`, {
				method: "POST",
				headers: { "Content-Type": "text/plain" },
				body: data,
			}).catch(() => {
				/* swallow — UI will see the SSE close instead */
			});
		});

		// Resize the PTY when the host element resizes (split-pane drag,
		// window resize, etc.).
		const ro = new ResizeObserver(() => {
			if (!fitRef.current || !termRef.current) return;
			try {
				fitRef.current.fit();
			} catch {
				/* xterm not ready yet */
			}
			const { cols, rows } = termRef.current;
			fetch(`/api/pty/${encodeURIComponent(ptyId)}/resize`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ cols, rows }),
			}).catch(() => {});
		});
		ro.observe(hostRef.current);

		// SSE stream — `event: replay` carries base64-encoded scrollback,
		// `data: ...` carries base64-encoded live chunks, `event: exit`
		// signals normal termination.
		const src = new EventSource(
			`/api/pty/${encodeURIComponent(ptyId)}/stream`,
		);
		const decode = (b64: string) =>
			typeof window === "undefined" ? "" : atob(b64);
		/**
		 * Feed raw PTY bytes through the OSC 998 parser, then write the
		 * cleaned chunk to xterm. Each parsed event updates the badge
		 * (newest wins) and is forwarded to the optional `onOsc998`
		 * callback so the parent can drive higher-level reactions.
		 */
		const writeFiltered = (raw: string) => {
			const result = parserRef.current.feed(raw);
			if (result.clean) term.write(result.clean);
			if (result.events.length > 0) {
				setLastOsc(result.events[result.events.length - 1]);
				for (const ev of result.events) onOsc998?.(ev);
			}
		};
		src.onmessage = (e) => writeFiltered(decode(e.data));
		src.addEventListener("replay", (e) =>
			writeFiltered(decode((e as MessageEvent).data)),
		);
		src.addEventListener("exit", (e) => {
			const code = Number.parseInt((e as MessageEvent).data, 10);
			onClose?.(Number.isFinite(code) ? code : null);
		});
		src.onerror = () => {
			// Browser auto-reconnects; nothing for us to do unless we
			// want to surface a transient disconnect in the UI.
		};

		return () => {
			onData.dispose();
			ro.disconnect();
			src.close();
			term.dispose();
			termRef.current = null;
			fitRef.current = null;
			parserRef.current.reset();
		};
	}, [ptyId, onClose, onOsc998]);

	const badge = lastOsc ? badgeFor(lastOsc) : null;

	return (
		<div
			data-testid="terminal-pane-host"
			style={{
				display: "flex",
				flexDirection: "column",
				width: "100%",
				height: "100%",
				background: "#0c0c10",
			}}
		>
			{badge && (
				<div
					data-testid="terminal-osc998-badge"
					data-state={
						(lastOsc?.payload as { state?: string } | null)?.state ??
						"unknown"
					}
					style={{
						display: "flex",
						alignItems: "center",
						gap: "0.3rem",
						padding: "0.15rem 0.5rem",
						background: badge.bg,
						color: badge.color,
						borderBottom: "1px solid #30363d",
						fontFamily: "var(--mono, monospace)",
						fontSize: "0.7rem",
						fontWeight: 600,
					}}
				>
					<span>{badge.text}</span>
				</div>
			)}
			<div
				ref={hostRef}
				data-testid="terminal-pane"
				style={{
					width: "100%",
					flex: 1,
					background: "#0c0c10",
					overflow: "hidden",
					padding: "0.25rem",
				}}
			/>
		</div>
	);
}
