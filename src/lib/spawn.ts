/**
 * Node.js spawn utility that mimics the Bun.spawn API.
 * This allows the codebase to run on Node.js while maintaining
 * the same interface as Bun's spawn.
 */
import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";

export interface SpawnOptions {
	stdout?: "pipe" | "inherit" | "ignore";
	stderr?: "pipe" | "inherit" | "ignore";
	stdio?: "pipe" | "inherit" | "ignore";
	cwd?: string;
	env?: Record<string, string>;
}

export interface SpawnResult {
	exited: Promise<number>;
	stdout: {
		read(): Promise<Buffer>;
		text(): Promise<string>;
	};
	stderr: {
		read(): Promise<Buffer>;
		text(): Promise<string>;
	};
}

/**
 * Collects all data from a stream into a buffer.
 * Resolves when the stream ends or the process exits.
 */
function collectStream(stream: NodeJS.ReadableStream | null): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		if (!stream) {
			resolve(Buffer.alloc(0));
			return;
		}
		const chunks: Buffer[] = [];
		stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
		stream.on("end", () => resolve(Buffer.concat(chunks)));
		stream.on("error", reject);
		// Also resolve on close in case end doesn't fire
		stream.on("close", () => {
			if (chunks.length >= 0) {
				resolve(Buffer.concat(chunks));
			}
		});
	});
}

/**
 * Mimics Bun.spawn API using Node.js child_process.
 * Usage: spawn(["git", "status"], { stdout: "pipe", stderr: "pipe" })
 */
export function spawn(args: string[], options: SpawnOptions = {}): SpawnResult {
	const spawnOptions: {
		stdio: ("ignore" | "pipe" | "inherit")[];
		cwd?: string;
		env?: Record<string, string>;
	} = {
		stdio: [
			"ignore", // stdin
			options.stdout ?? "pipe",
			options.stderr ?? "pipe",
		],
	};

	if (options.cwd) {
		spawnOptions.cwd = options.cwd;
	}

	if (options.env) {
		// Filter undefined values from process.env so the merged record
		// satisfies the node spawn `Record<string, string>` env type.
		const baseEnv: Record<string, string> = {};
		for (const [k, v] of Object.entries(process.env)) {
			if (typeof v === "string") baseEnv[k] = v;
		}
		spawnOptions.env = { ...baseEnv, ...options.env };
	}

	const child = nodeSpawn(args[0], args.slice(1), spawnOptions);

	// Start collecting stdout and stderr immediately
	const stdoutPromise = collectStream(child.stdout);
	const stderrPromise = collectStream(child.stderr);

	// Create a promise that resolves when the process exits
	const exitedPromise = new Promise<number>((resolve, reject) => {
		child.on("exit", (code) => {
			resolve(code ?? 0);
		});
		child.on("error", (err) => {
			reject(err);
		});
	});

	return {
		exited: exitedPromise,
		stdout: {
			read: () => stdoutPromise,
			text: async (): Promise<string> => {
				const buffer = await stdoutPromise;
				return buffer.toString("utf-8");
			},
		},
		stderr: {
			read: () => stderrPromise,
			text: async (): Promise<string> => {
				const buffer = await stderrPromise;
				return buffer.toString("utf-8");
			},
		},
	};
}
