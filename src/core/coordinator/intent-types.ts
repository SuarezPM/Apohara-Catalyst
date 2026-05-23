/**
 * Intent types for the smart router (G6.D.1).
 *
 * Mirrors `crates/apohara-types/src/intent.rs` — the canonical enum lives
 * in Rust, ts-rs exports it to `packages/apohara-shared/types.ts` (§0.7
 * SSoT, never hand-edit). This file is the TS-side wrapper: re-export the
 * generated alias, expose a typed list of all variants, and centralise
 * the default Intent → provider mapping that mirrors
 * `default_provider_for` in Rust.
 *
 * Feature-flag: `APOHARA_SMART_ROUTER=1`. OFF by default. Consumers MUST
 * call `isSmartRouterEnabled()` before invoking the classifier — calling
 * the classifier with the flag off SHOULD short-circuit to `other`.
 */
import type { Intent as IntentGenerated } from "../../../packages/apohara-shared/types";

// Re-export the generated alias so callers import a single name and a
// single source of truth. If the generated file lags (e.g. someone
// modified intent.rs but forgot to run `bun run generate-types`), fall
// back to the local literal union so TS code keeps compiling — tests
// surface drift via `generate-types:check`.
export type Intent =
	| IntentGenerated
	| "implement"
	| "refactor"
	| "debug"
	| "document"
	| "test"
	| "explain"
	| "review"
	| "other";

export const ALL_INTENTS: readonly Intent[] = [
	"implement",
	"refactor",
	"debug",
	"document",
	"test",
	"explain",
	"review",
	"other",
] as const;

export type ProviderId = "claude-code-cli" | "codex-cli" | "opencode-go";

/**
 * Mirrors `apohara_types::intent::default_provider_for` — keep in sync
 * with the Rust mapping. Active roster is restricted to 3 CLIs per spec
 * (§4 active providers); any new intent MUST land here AND in Rust.
 */
const DEFAULT_PROVIDER_BY_INTENT: Readonly<Record<Intent, ProviderId>> = {
	implement: "claude-code-cli",
	refactor: "codex-cli",
	debug: "claude-code-cli",
	document: "opencode-go",
	test: "claude-code-cli",
	explain: "opencode-go",
	review: "codex-cli",
	other: "claude-code-cli",
};

export function defaultProviderFor(intent: Intent): ProviderId {
	return DEFAULT_PROVIDER_BY_INTENT[intent] ?? "claude-code-cli";
}

export function isIntent(value: unknown): value is Intent {
	return (
		typeof value === "string" && (ALL_INTENTS as readonly string[]).includes(value)
	);
}

export function isSmartRouterEnabled(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return env.APOHARA_SMART_ROUTER === "1";
}
