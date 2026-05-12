/**
 * ContextForge HTTP client — M015.2 of the Apohara Roadmap.
 *
 * Talks to the Apohara_Context_Forge FastAPI sidecar (default :8001).
 * Two endpoints are consumed:
 *   POST /tools/register_context     — register an agent's context once
 *   POST /tools/get_optimized_context — get a compressed/deduped context per call
 *
 * Schemas mirror `apohara_context_forge/models.py:82-95` (request) and
 * `apohara_context_forge/models.py:33-48` (CompressionDecision response).
 *
 * Contract:
 *  - `fromEnv()` returns `null` when `CONTEXTFORGE_ENABLED` ≠ "1". Apohara
 *    behaves byte-identical to today when the sidecar is opt-out.
 *  - Every call is best-effort: timeout, network error, non-2xx (including
 *    the documented 503 passthrough fallback), or JSON parse error → method
 *    returns `null` and emits a deduped `contextforge_unavailable` ledger event.
 *    ContextForge failure CANNOT block a real LLM call.
 *  - No retries. Single 3 s timeout by default.
 */
import type { EventLedger } from "./ledger";

export interface ContextForgeConfig {
	enabled: boolean;
	baseUrl: string;
	timeoutMs: number;
	ledger?: EventLedger;
}

/** Response of POST /tools/register_context — `ContextEntry` from server. */
export interface RegisterResult {
	agent_id: string;
	token_count: number;
	/** May be null if the compressor didn't fire on registration. */
	compressed_token_count: number | null;
	ttl_seconds: number;
}

/** Response of POST /tools/get_optimized_context — `CompressionDecision`. */
export interface OptimizeResult {
	strategy: "apc_reuse" | "compress" | "compress_and_reuse" | "passthrough";
	/** Canonical field per server.py — the string Apohara should send to LLM. */
	final_context: string;
	original_tokens: number;
	final_tokens: number;
	tokens_saved: number;
	savings_pct: number;
	rationale: string;
}

type UnavailableReason = "timeout" | "network" | "parse" | `http_${number}`;

/**
 * HTTP client for the ContextForge sidecar. Constructed lazily from
 * environment via `ContextForgeClient.fromEnv(...)`; returns `null`
 * when disabled, so call sites simply do `client?.optimize(...)`.
 */
export class ContextForgeClient {
	readonly baseUrl: string;
	readonly timeoutMs: number;
	private readonly ledger?: EventLedger;

	// Dedup window for `contextforge_unavailable` events. A dead sidecar
	// could otherwise flood the ledger with one entry per LLM call.
	private static readonly UNAVAILABLE_LOG_DEDUP_MS = 60_000;
	private lastUnavailableLogMs = 0;

	private constructor(cfg: ContextForgeConfig) {
		this.baseUrl = cfg.baseUrl.replace(/\/+$/, "");
		this.timeoutMs = cfg.timeoutMs;
		this.ledger = cfg.ledger;
	}

	/**
	 * Construct from process env. Returns `null` when disabled so call
	 * sites can do `ContextForgeClient.fromEnv(ledger)?.optimize(...)`.
	 */
	static fromEnv(ledger?: EventLedger): ContextForgeClient | null {
		if (process.env.CONTEXTFORGE_ENABLED !== "1") {
			return null;
		}
		return new ContextForgeClient({
			enabled: true,
			baseUrl: process.env.CONTEXTFORGE_BASE_URL ?? "http://localhost:8001",
			timeoutMs: Number(process.env.CONTEXTFORGE_TIMEOUT_MS ?? "3000"),
			ledger,
		});
	}

	/** GET /health. Lightweight liveness probe. Never throws. */
	async health(): Promise<boolean> {
		try {
			const r = await fetch(`${this.baseUrl}/health`, {
				signal: AbortSignal.timeout(this.timeoutMs),
			});
			return r.ok;
		} catch {
			return false;
		}
	}

	/**
	 * POST /tools/register_context. Registers an agent's context for
	 * later optimization. Fire-and-forget at task spawn time.
	 */
	async register(
		agentId: string,
		context: string,
	): Promise<RegisterResult | null> {
		return this.callJson<RegisterResult>(
			"/tools/register_context",
			{ agent_id: agentId, context },
			"contextforge_registered",
			(latencyMs, data) => ({
				agent_id: agentId,
				token_count: data.token_count,
				latencyMs,
			}),
		);
	}

	/**
	 * POST /tools/get_optimized_context. Returns the (potentially
	 * compressed/deduped) context to send to the LLM. Callers should
	 * substitute their last user message content with `result.final_context`.
	 * On any failure returns `null` and the caller falls back to the
	 * original context.
	 */
	async optimize(
		agentId: string,
		context: string,
	): Promise<OptimizeResult | null> {
		return this.callJson<OptimizeResult>(
			"/tools/get_optimized_context",
			{ agent_id: agentId, context },
			"contextforge_optimized",
			(latencyMs, data) => ({
				agent_id: agentId,
				strategy: data.strategy,
				original_tokens: data.original_tokens,
				final_tokens: data.final_tokens,
				tokens_saved: data.tokens_saved,
				savings_pct: data.savings_pct,
				latencyMs,
			}),
		);
	}

	private async callJson<T>(
		path: string,
		body: { agent_id: string; context: string },
		successEvent: string,
		buildPayload: (latencyMs: number, data: T) => Record<string, unknown>,
	): Promise<T | null> {
		const url = `${this.baseUrl}${path}`;
		const startedAt = Date.now();
		let response: Response;
		try {
			response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(this.timeoutMs),
			});
		} catch (err) {
			const reason: UnavailableReason =
				(err as Error)?.name === "TimeoutError" ||
				(err as Error)?.name === "AbortError"
					? "timeout"
					: "network";
			await this.logUnavailable(path, reason, Date.now() - startedAt);
			return null;
		}

		if (!response.ok) {
			await this.logUnavailable(
				path,
				`http_${response.status}` as UnavailableReason,
				Date.now() - startedAt,
			);
			return null;
		}

		let data: T;
		try {
			data = (await response.json()) as T;
		} catch {
			await this.logUnavailable(path, "parse", Date.now() - startedAt);
			return null;
		}

		const latencyMs = Date.now() - startedAt;
		await this.ledger?.log(successEvent, buildPayload(latencyMs, data), "info");
		return data;
	}

	private async logUnavailable(
		endpoint: string,
		reason: UnavailableReason,
		latencyMs: number,
	): Promise<void> {
		const now = Date.now();
		if (
			now - this.lastUnavailableLogMs <
			ContextForgeClient.UNAVAILABLE_LOG_DEDUP_MS
		) {
			return;
		}
		this.lastUnavailableLogMs = now;
		await this.ledger?.log(
			"contextforge_unavailable",
			{ endpoint, reason, latencyMs },
			"warning",
		);
	}
}
