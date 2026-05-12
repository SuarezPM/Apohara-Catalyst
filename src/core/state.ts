import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { OrchestratorState } from "./types";

export class StateMachine {
	private filePath: string;
	private tmpPath: string;
	private state: OrchestratorState;
	private initialized = false;

	constructor(filePath?: string) {
		this.filePath = filePath || join(process.cwd(), ".apohara", "state.json");
		this.tmpPath = `${this.filePath}.tmp`;
		this.state = this.createInitialState();
	}

	/**
	 * Ensures the directory exists.
	 */
	private async init(): Promise<void> {
		if (this.initialized) return;
		await mkdir(dirname(this.filePath), { recursive: true });
		this.initialized = true;
	}

	/**
	 * Creates a default initial state.
	 */
	private createInitialState(): OrchestratorState {
		return {
			currentTaskId: null,
			tasks: [],
			status: "idle",
			failedProviderTimestamps: {},
		};
	}

	/**
	 * Loads the state from disk if it exists, otherwise uses the initial state.
	 */
	public async load(): Promise<OrchestratorState> {
		await this.init();
		try {
			const data = await readFile(this.filePath, "utf-8");
			this.state = JSON.parse(data) as OrchestratorState;
		} catch (_error) {
			// If file doesn't exist, we just start fresh.
			// Ideally we could check error.code === 'ENOENT', but any read/parse error
			// effectively means we need to start over (or recover). For MVP, we start over.
			this.state = this.createInitialState();
		}
		return this.state;
	}

	/**
	 * Retrieves the current in-memory state.
	 */
	public get(): OrchestratorState {
		return this.state;
	}

	/**
	 * Updates the state in-memory and persists it atomically to disk.
	 */
	public async update(
		updater: (state: OrchestratorState) => OrchestratorState,
	): Promise<void> {
		await this.init();

		this.state = updater(this.state);
		const data = JSON.stringify(this.state, null, 2);

		// Atomic write: write to a temporary file, then rename it.
		// This ensures we never end up with a partially written or corrupted state.json
		await writeFile(this.tmpPath, data, "utf-8");
		await rename(this.tmpPath, this.filePath);
	}

	/**
	 * Records a provider failure timestamp for cooldown tracking.
	 */
	public async recordProviderFailure(providerId: string): Promise<void> {
		await this.update((state) => ({
			...state,
			failedProviderTimestamps: {
				...state.failedProviderTimestamps,
				[providerId]: Date.now(),
			},
		}));
	}

	/**
	 * Gets the timestamp of the last failure for a provider.
	 */
	public getProviderLastFailure(providerId: string): number | null {
		return this.state.failedProviderTimestamps?.[providerId] ?? null;
	}

	/**
	 * Clears the cooldown for a provider.
	 */
	public async clearProviderCooldown(providerId: string): Promise<void> {
		await this.update((state) => {
			const newTimestamps = { ...state.failedProviderTimestamps };
			delete newTimestamps[providerId];
			return {
				...state,
				failedProviderTimestamps: newTimestamps,
			};
		});
	}
}
