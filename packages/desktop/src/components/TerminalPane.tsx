/**
 * TerminalPane — xterm.js consumer for an embedded PTY.
 *
 * Props:
 *   - `ptyId` — already-spawned PTY id (from `POST /api/pty`).
 *   - `onClose` — called when the PTY exits / the user kills it.
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
 *
 * No PTY is created here; callers (e.g. the dispatch flow) spawn
 * one and hand the id down. Keeping spawn and render apart means
 * the same component renders a PTY session that survives a tab
 * switch / re-attach.
 */
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export interface TerminalPaneProps {
	ptyId: string;
	onClose?: (exitCode: number | null) => void;
}

export function TerminalPane({ ptyId, onClose }: TerminalPaneProps) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const termRef = useRef<Terminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);

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
		src.onmessage = (e) => term.write(decode(e.data));
		src.addEventListener("replay", (e) =>
			term.write(decode((e as MessageEvent).data)),
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
		};
	}, [ptyId, onClose]);

	return (
		<div
			ref={hostRef}
			data-testid="terminal-pane"
			style={{
				width: "100%",
				height: "100%",
				background: "#0c0c10",
				overflow: "hidden",
				padding: "0.25rem",
			}}
		/>
	);
}
