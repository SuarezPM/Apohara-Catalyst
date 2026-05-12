import { spawn } from "../lib/spawn";

export interface IsolationResult {
	status: "success" | "error";
	message?: string;
	error?: string;
}

export class IsolationEngine {
	private binaryPath: string;

	constructor(binaryPath = "isolation-engine/target/debug/isolation-engine") {
		this.binaryPath = binaryPath;
	}

	/**
	 * Creates a new git worktree using the Rust isolation engine.
	 */
	public async createWorktree(
		path: string,
		branch: string,
		cwd?: string,
	): Promise<IsolationResult> {
		return this.executeWithRetry(["create", path, branch], cwd);
	}

	/**
	 * Destroys an existing git worktree using the Rust isolation engine.
	 */
	public async destroyWorktree(
		path: string,
		cwd?: string,
	): Promise<IsolationResult> {
		return this.executeWithRetry(["destroy", path], cwd);
	}

	/**
	 * Executes the Rust binary with exponential backoff (1s, 4s, 16s).
	 */
	private async executeWithRetry(
		args: string[],
		cwd?: string,
	): Promise<IsolationResult> {
		const retries = [1000, 4000, 16000];
		let attempt = 0;

		while (attempt <= retries.length) {
			try {
				const result = await this.executeBinary(args, cwd);
				if (result.status === "error") {
					// Rust binary returned an expected logic error (e.g. git failed)
					// We return it instead of retrying, because it's a domain error, not an IPC/OS failure.
					// However, if we want to be truly resilient to OS lags, we might want to retry some git errors too,
					// but usually git errors are deterministic (like branch already exists).
					return result;
				}
				return result;
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				console.warn(
					`[IsolationEngine] IPC Attempt ${attempt + 1} failed: ${errorMessage}`,
				);

				if (attempt < retries.length) {
					const delay = retries[attempt];
					console.log(`[IsolationEngine] Retrying in ${delay}ms...`);
					await new Promise((resolve) => setTimeout(resolve, delay));
					attempt++;
				} else {
					console.error("[IsolationEngine] All IPC attempts failed.");
					return { status: "error", error: errorMessage };
				}
			}
		}

		return { status: "error", error: "Unreachable" };
	}

	private async executeBinary(
		args: string[],
		cwd?: string,
	): Promise<IsolationResult> {
		const proc = spawn([this.binaryPath, ...args], {
			stdout: "pipe",
			stderr: "pipe",
			cwd: cwd,
		});

		const exitCode = await proc.exited;
		const stdout = await proc.stdout.text();
		const stderr = await proc.stderr.text();

		if (exitCode !== 0 && stdout.trim() === "") {
			throw new Error(`Binary exited with code ${exitCode}. Stderr: ${stderr}`);
		}

		try {
			return JSON.parse(stdout) as IsolationResult;
		} catch (_e) {
			throw new Error(
				`Failed to parse binary output: ${stdout}. Stderr: ${stderr}`,
			);
		}
	}
}
