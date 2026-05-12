import { useEffect, useRef, useState } from "react";

/**
 * RosterPicker — top-bar control that lets the user enable/disable any
 * provider for this run. Implements the core "multi-AI orchestrator"
 * pitch: the user picks the AI roster (Claude + GPT-4 + Gemini + …)
 * and Apohara dispatches microtasks across only those providers.
 *
 * Persistence: the selected set is mirrored to localStorage and POSTed
 * to `/api/roster` so the server holds the canonical view.
 *
 * The full provider list is intentionally hardcoded here rather than
 * fetched — the router's ProviderId type is the source of truth and a
 * full client fetch round-trip would just re-serialize what the type
 * already encodes. A future migration can swap this for `/api/providers`
 * if the list ever becomes dynamic.
 */

export type ProviderId =
	| "claude-code-cli"
	| "codex-cli"
	| "gemini-cli"
	| "opencode-go"
	| "anthropic-api"
	| "gemini-api"
	| "openai"
	| "deepseek-v4"
	| "deepseek"
	| "groq"
	| "moonshot-k2.6"
	| "moonshot-k2.5"
	| "qwen3.6-plus"
	| "qwen3.5-plus"
	| "minimax-m2.7"
	| "minimax-m2.5"
	| "xiaomi-mimo"
	| "glm-zai"
	| "glm-fireworks"
	| "glm-deepinfra"
	| "mistral"
	| "kiro-ai"
	| "tavily"
	| "gemini"
	| "carnice-9b-local";

interface Group {
	label: string;
	hint: string;
	providers: { id: ProviderId; label: string }[];
}

const GROUPS: Group[] = [
	{
		label: "CLI drivers",
		hint: "Bring your own subscriptions. Drives the official agent CLIs as subprocesses — no API keys, your TOS.",
		providers: [
			{ id: "claude-code-cli", label: "Claude Code (Anthropic CLI)" },
			{ id: "codex-cli", label: "Codex (OpenAI CLI)" },
			{ id: "gemini-cli", label: "Gemini CLI (Google)" },
			{ id: "opencode-go", label: "opencode (multi-vendor CLI)" },
		],
	},
	{
		label: "Cloud APIs",
		hint: "Direct API access. Requires the matching API key in your environment.",
		providers: [
			{ id: "anthropic-api", label: "Anthropic API" },
			{ id: "openai", label: "OpenAI" },
			{ id: "gemini-api", label: "Google AI Studio (Gemini)" },
			{ id: "deepseek-v4", label: "DeepSeek V4" },
			{ id: "deepseek", label: "DeepSeek" },
			{ id: "groq", label: "Groq" },
			{ id: "moonshot-k2.6", label: "Kimi K2.6 (Moonshot)" },
			{ id: "moonshot-k2.5", label: "Kimi K2.5 (Moonshot)" },
			{ id: "qwen3.6-plus", label: "Qwen 3.6 Plus" },
			{ id: "qwen3.5-plus", label: "Qwen 3.5 Plus" },
			{ id: "minimax-m2.7", label: "MiniMax M2.7" },
			{ id: "minimax-m2.5", label: "MiniMax M2.5" },
			{ id: "xiaomi-mimo", label: "Xiaomi MiMo" },
			{ id: "glm-zai", label: "GLM (Z.ai)" },
			{ id: "glm-fireworks", label: "GLM (Fireworks)" },
			{ id: "glm-deepinfra", label: "GLM (DeepInfra)" },
			{ id: "mistral", label: "Mistral" },
			{ id: "kiro-ai", label: "Kiro AI" },
			{ id: "tavily", label: "Tavily (search)" },
			{ id: "gemini", label: "Gemini (generateContent)" },
		],
	},
	{
		label: "Local",
		hint: "Optional GPU booster. Zero cloud tokens when the local server is up.",
		providers: [
			{
				id: "carnice-9b-local",
				label: "Carnice-9b (llama-cpp + ContextForge)",
			},
		],
	},
];

export const ALL_PROVIDERS: ProviderId[] = GROUPS.flatMap((g) =>
	g.providers.map((p) => p.id),
);

interface Props {
	enabled: Set<ProviderId>;
	onChange: (next: Set<ProviderId>) => void;
}

export function RosterPicker({ enabled, onChange }: Props) {
	const [open, setOpen] = useState(false);
	const popoverRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const onDocClick = (e: MouseEvent) => {
			if (!popoverRef.current?.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", onDocClick);
		return () => document.removeEventListener("mousedown", onDocClick);
	}, [open]);

	const count = enabled.size;
	const label =
		count === ALL_PROVIDERS.length
			? "All AIs"
			: count === 0
				? "No AIs selected"
				: `${count} AIs`;

	function toggle(id: ProviderId) {
		const next = new Set(enabled);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		onChange(next);
	}

	function setGroupAll(group: Group, state: boolean) {
		const next = new Set(enabled);
		for (const p of group.providers) {
			if (state) next.add(p.id);
			else next.delete(p.id);
		}
		onChange(next);
	}

	return (
		<div className="roster-picker" ref={popoverRef}>
			<button
				type="button"
				className="roster-button mono"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				title="Pick which AIs participate in this run"
			>
				◈ {label}
			</button>
			{open && (
				<div className="roster-popover" role="dialog" aria-label="AI roster">
					<div className="roster-header">
						<span className="roster-title">AI roster for this run</span>
						<button
							type="button"
							className="roster-action"
							onClick={() => onChange(new Set(ALL_PROVIDERS))}
							disabled={count === ALL_PROVIDERS.length}
						>
							Enable all
						</button>
						<button
							type="button"
							className="roster-action"
							onClick={() => onChange(new Set())}
							disabled={count === 0}
						>
							Clear
						</button>
					</div>
					{GROUPS.map((group) => {
						const groupAllOn = group.providers.every((p) => enabled.has(p.id));
						return (
							<section className="roster-group" key={group.label}>
								<header className="roster-group-header">
									<label className="roster-group-label">
										<input
											type="checkbox"
											checked={groupAllOn}
											onChange={(e) => setGroupAll(group, e.target.checked)}
										/>
										<span className="roster-group-name">{group.label}</span>
									</label>
									<span className="roster-group-hint">{group.hint}</span>
								</header>
								<ul className="roster-provider-list">
									{group.providers.map((p) => (
										<li key={p.id}>
											<label className="roster-provider mono">
												<input
													type="checkbox"
													checked={enabled.has(p.id)}
													onChange={() => toggle(p.id)}
												/>
												<span>{p.label}</span>
											</label>
										</li>
									))}
								</ul>
							</section>
						);
					})}
				</div>
			)}
		</div>
	);
}
