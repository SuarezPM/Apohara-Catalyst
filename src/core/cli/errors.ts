/**
 * CLI error class per spec §0.9.
 *
 * Three exit codes: EXIT_SUCCESS=0, EXIT_USER_ERROR=1, EXIT_ENV_ERROR=2.
 * Errors carry {code, message, remediation} so JSON mode consumers can
 * reliably parse and surface them.
 */

export const EXIT_SUCCESS = 0;
export const EXIT_USER_ERROR = 1;
export const EXIT_ENV_ERROR = 2;

export type ExitCode = typeof EXIT_SUCCESS | typeof EXIT_USER_ERROR | typeof EXIT_ENV_ERROR;

export interface ApoharaErrorShape {
  code: string;
  message: string;
  remediation: string;
  exitCode?: ExitCode;
}

export class ApoharaError extends Error {
  readonly code: string;
  readonly remediation: string;
  readonly exitCode: ExitCode;

  constructor(opts: ApoharaErrorShape) {
    super(opts.message);
    this.name = "ApoharaError";
    this.code = opts.code;
    this.remediation = opts.remediation;
    this.exitCode = opts.exitCode ?? EXIT_USER_ERROR;
  }

  toJSON(): { code: string; message: string; remediation: string } {
    return { code: this.code, message: this.message, remediation: this.remediation };
  }
}
