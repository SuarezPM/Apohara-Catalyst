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
import { inspect } from "node:util";
import { ApoharaError, type ApoharaErrorShape, EXIT_SUCCESS, EXIT_USER_ERROR, EXIT_ENV_ERROR, type ExitCode } from "./errors";

export { ApoharaError, EXIT_SUCCESS, EXIT_USER_ERROR, EXIT_ENV_ERROR };
export type { ExitCode, ApoharaErrorShape };

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
      // util.inspect handles cycles, BigInt, functions, undefined, symbols
      // (JSON.stringify throws on cycles/BigInt and silently drops the rest).
      stdout.write(inspect(data, { depth: null, colors: stdout.isTTY ?? false }) + "\n");
    }
  }
}

export function emitError(error: ApoharaError | ApoharaErrorShape, options: IoOptions): void {
  const stderr = options.stderr ?? process.stderr;
  // Coerce loose shapes (JSON.parse, IPC, unknown casts) into a fully populated
  // payload — never leak "undefined" into human-facing text output.
  const shape: ApoharaErrorShape = error instanceof ApoharaError
    ? { code: error.code, message: error.message, remediation: error.remediation, exitCode: error.exitCode }
    : {
        code: error.code ?? "UNKNOWN",
        message: error.message ?? "(no message)",
        remediation: error.remediation ?? "(no remediation provided)",
        exitCode: error.exitCode,
      };
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
 *
 * Idempotent: repeated calls (per-test setup, --watch re-entry, subcommand
 * re-install with a different jsonMode) detach the previous handlers before
 * attaching new ones, so process.exit only fires once per crash.
 */
let installedHandlers: { uncaught: (err: unknown) => void; rejected: (err: unknown) => void } | null = null;

export function installGlobalErrorHandlers(jsonMode: boolean): void {
  if (installedHandlers) {
    process.removeListener("uncaughtException", installedHandlers.uncaught);
    process.removeListener("unhandledRejection", installedHandlers.rejected);
  }

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

  const uncaught = handle("exception");
  const rejected = handle("rejection");
  process.on("uncaughtException", uncaught);
  process.on("unhandledRejection", rejected);
  installedHandlers = { uncaught, rejected };
}
