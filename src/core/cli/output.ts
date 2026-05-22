/**
 * Stdout/stderr contract per spec §0.9.
 *
 * Rules:
 * - results to stdout, diagnostics/errors to stderr, NEVER mixed
 * - JSON mode propagates the same separation
 * - emitResult() to stdout
 * - emitError({code, message, remediation}) to stderr
 * - emitDiagnostic() to stderr (always)
 * - Even argparse errors emit the correct shape under --json
 *
 * Apohara CLI must be parseable by other LLMs (Apohara as a tool of another agent).
 * Any noise on stdout breaks parsing.
 */
import { ApoharaError, type ApoharaErrorShape, EXIT_SUCCESS, EXIT_USER_ERROR, EXIT_ENV_ERROR, type ExitCode } from "./errors";

export { ApoharaError, EXIT_SUCCESS, EXIT_USER_ERROR, EXIT_ENV_ERROR };
export type { ExitCode };

export interface IoOptions {
  jsonMode: boolean;
  stdout?: NodeJS.WriteStream;
  stderr?: NodeJS.WriteStream;
}

export function emitResult(data: unknown, options: IoOptions): void {
  const stdout = options.stdout ?? process.stdout;
  if (options.jsonMode) {
    stdout.write(JSON.stringify(data) + "\n");
  } else {
    if (typeof data === "string") {
      stdout.write(data + (data.endsWith("\n") ? "" : "\n"));
    } else {
      stdout.write(JSON.stringify(data, null, 2) + "\n");
    }
  }
}

export function emitError(error: ApoharaError | ApoharaErrorShape, options: IoOptions): void {
  const stderr = options.stderr ?? process.stderr;
  const shape: ApoharaErrorShape = error instanceof ApoharaError
    ? { code: error.code, message: error.message, remediation: error.remediation, exitCode: error.exitCode }
    : error;
  if (options.jsonMode) {
    const { exitCode: _ignored, ...payload } = shape;
    stderr.write(JSON.stringify(payload) + "\n");
  } else {
    stderr.write(`error[${shape.code}]: ${shape.message}\n  remediation: ${shape.remediation}\n`);
  }
}

export function emitDiagnostic(message: string, options: IoOptions): void {
  const stderr = options.stderr ?? process.stderr;
  if (options.jsonMode) {
    stderr.write(JSON.stringify({ _diagnostic: true, message }) + "\n");
  } else {
    stderr.write(`[apohara] ${message}\n`);
  }
}

/**
 * Install a global unhandled rejection / uncaught exception handler that
 * always emits the correct shape per --json mode and exits with EXIT_ENV_ERROR.
 * Call this once from the CLI entry point.
 */
export function installGlobalErrorHandlers(jsonMode: boolean): void {
  const handle = (origin: string) => (err: unknown) => {
    const error: ApoharaErrorShape = err instanceof ApoharaError
      ? { code: err.code, message: err.message, remediation: err.remediation, exitCode: err.exitCode }
      : {
          code: "UNCAUGHT_" + origin.toUpperCase(),
          message: err instanceof Error ? err.message : String(err),
          remediation: "report this as a bug at https://github.com/SuarezPM/Apohara/issues",
          exitCode: EXIT_ENV_ERROR,
        };
    emitError(error, { jsonMode });
    process.exit(error.exitCode ?? EXIT_ENV_ERROR);
  };
  process.on("uncaughtException", handle("exception"));
  process.on("unhandledRejection", handle("rejection"));
}
