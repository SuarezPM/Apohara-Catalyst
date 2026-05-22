import { openOrchestrationDb } from "../core/orchestration/db";
import { sendMessage, listUnread, type MessageType } from "../core/orchestration/messages";
import { insertTask, updateTaskStatus, type TaskStatus, type TaskSpec } from "../core/orchestration/tasks";
import { emitResult, emitError, ApoharaError, EXIT_SUCCESS, EXIT_USER_ERROR } from "../core/cli/output";

export interface RunOrchestrationOptions { dbPath: string; args: string[]; }
export interface RunOrchestrationResult { exitCode: number; stdout: string; stderr: string; }

export async function runOrchestrationCommand(opts: RunOrchestrationOptions): Promise<RunOrchestrationResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const fakeStdout = { write: (s: string | Uint8Array) => { stdoutChunks.push(s.toString()); return true; }, isTTY: false } as unknown as NodeJS.WriteStream;
  const fakeStderr = { write: (s: string | Uint8Array) => { stderrChunks.push(s.toString()); return true; }, isTTY: false } as unknown as NodeJS.WriteStream;
  const jsonMode = opts.args.includes("--json") || (opts.args.includes("--format") && opts.args[opts.args.indexOf("--format") + 1] === "json");
  const io = { jsonMode, stdout: fakeStdout, stderr: fakeStderr };

  const db = await openOrchestrationDb(opts.dbPath);
  try {
    const [sub, ...rest] = opts.args;
    switch (sub) {
      case "send": {
        const to = getFlag(rest, "--to");
        const type = getFlag(rest, "--type") as MessageType | undefined;
        const from = getFlag(rest, "--from");
        const body = getFlag(rest, "--body");
        if (!to || !type || !from) {
          const err = new ApoharaError({ code: "MISSING_ARGS", message: "send requires --to, --type, --from", remediation: "apohara orchestration send --to @handle --type <type> --from @handle [--body <text>]", exitCode: EXIT_USER_ERROR });
          emitError(err, io);
          return { exitCode: EXIT_USER_ERROR, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
        }
        const id = sendMessage(db, { fromHandle: from, toHandle: to, type, body: body ?? undefined, payload: null });
        emitResult({ ok: true, id }, io);
        return { exitCode: EXIT_SUCCESS, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
      }
      case "check": {
        const to = getFlag(rest, "--to");
        const typesFlag = getFlag(rest, "--types");
        if (!to) {
          const err = new ApoharaError({ code: "MISSING_ARGS", message: "check requires --to", remediation: "apohara orchestration check --to @handle [--types type1,type2]", exitCode: EXIT_USER_ERROR });
          emitError(err, io);
          return { exitCode: EXIT_USER_ERROR, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
        }
        const types = typesFlag ? typesFlag.split(",") as MessageType[] : undefined;
        const messages = listUnread(db, to, { types, limit: 1 });
        if (messages.length === 0) {
          emitResult({ ok: false, message: "no_messages" }, io);
        } else {
          emitResult(messages[0], io);
        }
        return { exitCode: EXIT_SUCCESS, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
      }
      case "task-create": {
        const id = getFlag(rest, "--id");
        const description = getFlag(rest, "--description");
        const role = getFlag(rest, "--role") as "planner" | "coder" | "critic" | "judge" | undefined;
        if (!id || !description || !role) {
          const err = new ApoharaError({ code: "MISSING_ARGS", message: "task-create requires --id, --description, --role", remediation: "apohara orchestration task-create --id <id> --description <text> --role <role>", exitCode: EXIT_USER_ERROR });
          emitError(err, io);
          return { exitCode: EXIT_USER_ERROR, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
        }
        insertTask(db, { id, spec: { description, agentRole: role, symbols: { reads: [], writes: [], renames: [] } }, deps: [] });
        emitResult({ ok: true, id }, io);
        return { exitCode: EXIT_SUCCESS, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
      }
      case "task-list": {
        const rows = db.raw().query("SELECT id, status, spec FROM tasks ORDER BY ts ASC").all() as Array<{ id: string; status: string; spec: string }>;
        const tasks = rows.map(r => ({ id: r.id, status: r.status, ...JSON.parse(r.spec) }));
        emitResult(tasks, io);
        return { exitCode: EXIT_SUCCESS, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
      }
      case "task-update": {
        const id = getFlag(rest, "--id");
        const status = getFlag(rest, "--status") as TaskStatus | undefined;
        if (!id || !status) {
          const err = new ApoharaError({ code: "MISSING_ARGS", message: "task-update requires --id and --status", remediation: "apohara orchestration task-update --id <id> --status <status>", exitCode: EXIT_USER_ERROR });
          emitError(err, io);
          return { exitCode: EXIT_USER_ERROR, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
        }
        updateTaskStatus(db, id, status);
        emitResult({ ok: true, id, status }, io);
        return { exitCode: EXIT_SUCCESS, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
      }
      default: {
        const err = new ApoharaError({ code: "UNKNOWN_SUBCOMMAND", message: `unknown orchestration subcommand: ${sub}`, remediation: "run `apohara orchestration --help`", exitCode: EXIT_USER_ERROR });
        emitError(err, io);
        return { exitCode: EXIT_USER_ERROR, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
      }
    }
  } finally { db.close(); }
}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}