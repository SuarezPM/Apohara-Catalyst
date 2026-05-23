/**
 * culture #7 — proxy a child CLI with lightweight interceptors that
 * observe stdout/stderr without modifying the flow. Useful for adding
 * Apohara telemetry/hooks to any tool without forking it.
 */
import { spawn } from "node:child_process";

export interface PassthroughOpts {
	binary: string;
	args: string[];
	interceptors: Array<(chunk: Buffer, stream: "stdout" | "stderr") => void>;
	env?: NodeJS.ProcessEnv;
}

export interface PassthroughResult {
	exitCode: number;
}

export function runPassthrough(opts: PassthroughOpts): Promise<PassthroughResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(opts.binary, opts.args, {
			env: opts.env ?? process.env,
			stdio: ["inherit", "pipe", "pipe"],
		});
		child.stdout?.on("data", (c: Buffer) => {
			for (const i of opts.interceptors) i(c, "stdout");
			process.stdout.write(c);
		});
		child.stderr?.on("data", (c: Buffer) => {
			for (const i of opts.interceptors) i(c, "stderr");
			process.stderr.write(c);
		});
		child.on("exit", (code) => resolve({ exitCode: code ?? 1 }));
		child.on("error", reject);
	});
}
