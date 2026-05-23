/**
 * HeroBanner — Apohara Catalyst empty-state intro card.
 *
 * Renders ONLY when:
 *   - No active session is running (sessionId === null), AND
 *   - The TaskBoard store has zero tasks (no demo seed, no live events).
 *
 * The moment either condition becomes false, the banner vanishes so the
 * user gets the full kanban surface back without an extra dismiss step.
 * Inspired by `vibe-kanban`'s onboarding panel (#17) which we adopted in
 * the v1.0 spec catch-up sweep.
 *
 * G9.A.3 rebrand: the wordmark switches to "APOHARA CATALYST" in the lime
 * token (`--apohara-lime`) via the `.font-display` utility class (Press
 * Start 2P). Background + accents use the Catalyst palette (ink, bone,
 * lime) so the empty-state matches the pixel-art aesthetic introduced in
 * G9.A.1 (CSS palette swap) and G9.A.2 (typography stack).
 *
 * Props are unchanged: App.tsx still passes `sessionId` + `onSeedDemo`.
 * The mascot sprite slot lands in G9.D.3 once the asset is wired.
 */
import { useAtomValue } from "jotai/react";
import { tasksAtom } from "../store/dagStore.js";
import { PixelCanvas, type Frame } from "./PixelCanvas.js";

export interface HeroBannerProps {
	/** Active session id; if non-null the banner hides. */
	sessionId: string | null;
	/**
	 * Optional callback fired when the user clicks "Seed demo tasks" —
	 * lets the parent invoke the same handler that the topbar button
	 * uses (so seed coverage stays single-source).
	 */
	onSeedDemo?: () => void;
}

export function HeroBanner({ sessionId, onSeedDemo }: HeroBannerProps) {
	const tasks = useAtomValue(tasksAtom);
	const isEmpty = Object.keys(tasks).length === 0;
	const taskList = Object.values(tasks ?? {});
	const anyWorking = taskList.some((t) =>
		["dispatched", "in_verification"].includes(t.status),
	);
	const anyStuck = taskList.some((t) =>
		["blocked", "failed"].includes(t.status),
	);
	const allDone =
		taskList.length > 0 && taskList.every((t) => t.status === "done");
	const frame: Frame = anyStuck
		? "thinking"
		: anyWorking
			? "working"
			: allDone
				? "happy"
				: "idle";
	if (sessionId !== null) return null;
	if (!isEmpty) return null;

	return (
		<section
			data-testid="hero-banner"
			role="region"
			aria-label="Apohara Catalyst welcome"
			style={{
				margin: "1.5rem auto",
				padding: "1.5rem 2rem",
				maxWidth: 720,
				background: "var(--apohara-ink)",
				border: "2px solid var(--apohara-lime)",
				borderRadius: 4,
				color: "var(--apohara-bone)",
				textAlign: "center",
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					gap: 16,
					marginBottom: "0.75rem",
				}}
			>
				<div data-testid="hero-banner-mascot" style={{ flexShrink: 0 }}>
					<PixelCanvas
						spriteUrl="/sprites/chief-mascot.png"
						frame={frame}
						size={48}
					/>
				</div>
				<h2
					className="font-display"
					data-testid="hero-banner-wordmark"
					style={{
						margin: 0,
						fontSize: "1.1rem",
						color: "var(--apohara-lime)",
						letterSpacing: "3px",
						lineHeight: 1.4,
					}}
				>
					APOHARA CATALYST
				</h2>
			</div>
			<p
				data-testid="hero-banner-tagline"
				style={{
					margin: 0,
					marginBottom: "1rem",
					color: "rgba(237, 239, 240, 0.7)",
					fontFamily: "var(--font-mono)",
					fontSize: "0.85rem",
				}}
			>
				Three sanctioned CLI drivers (claude, codex, opencode), one ledger,
				zero cloud sync. Type a goal and Apohara plans, dispatches, and
				verifies — without leaking your API keys to any subprocess.
			</p>
			<div
				style={{
					display: "flex",
					gap: "0.75rem",
					justifyContent: "center",
					flexWrap: "wrap",
				}}
			>
				{onSeedDemo && (
					<button
						type="button"
						data-testid="hero-banner-seed-cta"
						onClick={onSeedDemo}
						style={{
							padding: "0.5rem 1rem",
							background: "var(--apohara-lime)",
							color: "var(--apohara-ink)",
							border: "2px solid var(--apohara-lime)",
							borderRadius: 4,
							cursor: "pointer",
							fontFamily: "var(--font-mono)",
							fontSize: "0.8rem",
							fontWeight: 700,
							letterSpacing: "1px",
							textTransform: "uppercase",
						}}
					>
						Try the demo
					</button>
				)}
				<a
					data-testid="hero-banner-docs-link"
					href="https://github.com/SuarezPM/apohara#readme"
					target="_blank"
					rel="noreferrer noopener"
					style={{
						padding: "0.5rem 1rem",
						background: "transparent",
						color: "var(--apohara-bone)",
						border: "2px solid var(--apohara-bone)",
						borderRadius: 4,
						textDecoration: "none",
						fontFamily: "var(--font-mono)",
						fontSize: "0.8rem",
						fontWeight: 700,
						letterSpacing: "1px",
						textTransform: "uppercase",
					}}
				>
					Read the docs
				</a>
			</div>
		</section>
	);
}
