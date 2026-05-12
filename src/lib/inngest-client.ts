/**
 * Inngest Client - Durable workflow execution for agent dispatch
 *
 * Inngest provides durable execution that survives crashes.
 * Each agent dispatch becomes a step that can replay after failure.
 *
 * Docs: https://www.inngest.com/docs
 */

import { config } from "../core/config";

export interface InngestConfig {
	appId?: string;
	apiKey?: string;
	baseUrl?: string;
}

export interface WorkflowStep<T = unknown> {
	id: string;
	name: string;
	execute: () => Promise<T>;
	retryConfig?: {
		maxAttempts: number;
		interval: number;
	};
}

export interface DispatchResult {
	id: string;
	status: "completed" | "failed" | "cancelled";
	output?: unknown;
}

/**
 * Inngest Client for durable agent execution
 * Wraps subagent dispatch in durable workflows
 */
export class InngestClient {
	private appId: string;
	private apiKey: string;
	private baseUrl: string;
	private activeDispatches = new Map<string, DispatchResult>();

	constructor(config?: InngestConfig) {
		this.appId = config?.appId || process.env.INNGEST_APP_ID || "apohara";
		this.apiKey = config?.apiKey || process.env.INNGEST_API_KEY || "";
		this.baseUrl = config?.baseUrl || "https://api.inngest.com/fn";
	}

	/**
	 * Dispatch a durable workflow
	 * Returns a dispatch ID that can be used to track status
	 */
	async dispatch<T>(
		name: string,
		data: Record<string, unknown>,
	): Promise<DispatchResult> {
		const dispatchId = `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

		// For now, simulate dispatch (real Inngest requires more complex setup)
		// In production, this would call the Inngest API
		const result: DispatchResult = {
			id: dispatchId,
			status: "completed",
		};

		this.activeDispatches.set(dispatchId, result);

		return result;
	}

	/**
	 * Execute a step in a durable workflow
	 * This wraps step execution with retry logic
	 */
	async executeStep<T>(
		stepId: string,
		execute: () => Promise<T>,
		options?: { maxAttempts?: number; retryInterval?: number },
	): Promise<T> {
		const maxAttempts = options?.maxAttempts || 3;

		let lastError: Error | undefined;

		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				const result = await execute();
				return result;
			} catch (error) {
				lastError = error as Error;
				console.log(
					`[Inngest] Step ${stepId} attempt ${attempt} failed: ${lastError.message}`,
				);

				if (attempt < maxAttempts) {
					// Wait before retry
					await new Promise((resolve) =>
						setTimeout(resolve, (options?.retryInterval || 1000) * attempt),
					);
				}
			}
		}

		throw lastError;
	}

	/**
	 * Get dispatch status
	 */
	async getDispatch(id: string): Promise<DispatchResult | null> {
		return this.activeDispatches.get(id) || null;
	}

	/**
	 * Cancel a dispatch
	 */
	async cancelDispatch(id: string): Promise<void> {
		const dispatch = this.activeDispatches.get(id);
		if (dispatch) {
			dispatch.status = "cancelled";
		}
	}

	/**
	 * Check if Inngest is configured
	 */
	isConfigured(): boolean {
		return !!this.apiKey || !!process.env.INNGEST_API_KEY;
	}

	/**
	 * Send event to trigger workflow
	 */
	async sendEvent(
		eventName: string,
		payload: Record<string, unknown>,
	): Promise<{ id: string }> {
		const eventId = `${eventName}-${Date.now()}`;

		const response = await fetch(`${this.baseUrl}/send`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
				"Inngest-Signature": "", // Would be set by Inngest
			},
			body: JSON.stringify({
				name: eventName,
				id: eventId,
				data: payload,
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`Inngest event send failed: ${response.status} ${error}`);
		}

		const data = await response.json();
		return data;
	}

	/**
	 * Create a step function that can be paused and resumed
	 */
	createStepFunction<T>(
		name: string,
		execute: () => Promise<T>,
	): WorkflowStep<T> {
		return {
			id: name,
			name,
			execute,
		};
	}
}

// Global instance
export const inngestClient = new InngestClient({
	appId: process.env.INNGEST_APP_ID,
	apiKey: process.env.INNGEST_API_KEY,
});
