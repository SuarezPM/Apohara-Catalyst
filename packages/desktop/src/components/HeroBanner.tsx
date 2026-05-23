/**
 * HeroBanner — F11 empty-state intro card (G7.C.7).
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
 * The component is self-contained — it reads `tasksAtom` directly and
 * accepts `sessionId` as a prop so the parent (`App.tsx`) doesn't have
 * to drill conditional rendering.
 */
import { useAtomValue } from "jotai/react";
import { tasksAtom } from "../store/dagStore.js";

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
	if (sessionId !== null) return null;
	if (!isEmpty) return null;

	return (
		<section
			data-testid="hero-banner"
			role="region"
			aria-label="Apohara welcome"
			style={{
				margin: "1.5rem auto",
				padding: "1.5rem 2rem",
				maxWidth: 720,
				background: "linear-gradient(135deg, #161b22 0%, #0d1117 100%)",
				border: "1px solid #30363d",
				borderRadius: 8,
				color: "#e6edf3",
				textAlign: "center",
			}}
		>
			<h2
				style={{
					margin: 0,
					marginBottom: "0.5rem",
					fontSize: "1.4rem",
					fontWeight: 700,
				}}
			>
				Apohara — multi-agent orchestration, local-first.
			</h2>
			<p
				data-testid="hero-banner-tagline"
				style={{
					margin: 0,
					marginBottom: "1rem",
					color: "#8b949e",
					fontSize: "0.9rem",
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
							background: "#1f6feb",
							color: "#ffffff",
							border: "1px solid #1f6feb",
							borderRadius: 4,
							cursor: "pointer",
							fontSize: "0.85rem",
							fontWeight: 600,
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
						background: "#21262d",
						color: "#e6edf3",
						border: "1px solid #30363d",
						borderRadius: 4,
						textDecoration: "none",
						fontSize: "0.85rem",
						fontWeight: 600,
					}}
				>
					Read the docs
				</a>
			</div>
		</section>
	);
}
