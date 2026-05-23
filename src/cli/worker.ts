/**
 * `apohara worker` — runs an Apohara compute worker that connects to the local
 * SSH server (G6.C). Gated behind the `APOHARA_REMOTE_WORKERS=1` feature flag.
 *
 * v1.0 surface (this commit, G6.C.3): argument parsing + feature-flag gating +
 * endpoint discovery. The actual SSH client / handshake / dispatch loop lands
 * in G6.C.5..7.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export interface WorkerArgs {
  help: boolean;
  endpointPath?: string;
  keyPath?: string;
  maxConcurrentTasks: number;
  apoharaVersion: string;
  error?: { code: string; message: string };
}

export interface WorkerCommandOptions {
  args: string[];
  env: Partial<NodeJS.ProcessEnv>;
}

export interface WorkerCommandResult {
  exitCode: number;
  help?: boolean;
  endpoint?: WorkerEndpoint;
  error?: { code: string; message: string };
}

export interface WorkerEndpoint {
  host: string;
  port: number;
  pid: number;
  started_unix_ms: number;
}

const DEFAULT_MAX_TASKS = 1;
const APOHARA_VERSION = "1.0.0-dev";

export const USAGE = `Usage: apohara worker [options]

Connects this machine as an Apohara compute worker to the local SSH server.
The server is started by the apohara daemon when APOHARA_REMOTE_WORKERS=1.

Options:
  --endpoint <path>    Path to ssh-server endpoint.json (default: ~/.apohara/ssh-server/endpoint.json)
  --key <path>         SSH private key for auth (default: ~/.apohara/ssh-server/worker_key)
  --max-tasks <N>      Max concurrent tasks this worker accepts (default: 1)
  --help               Show this message

The worker refuses to start unless APOHARA_REMOTE_WORKERS=1 is set.
`;

export function defaultEndpointPath(): string {
  return join(homedir(), ".apohara", "ssh-server", "endpoint.json");
}

export function defaultKeyPath(): string {
  return join(homedir(), ".apohara", "ssh-server", "worker_key");
}

export function parseWorkerArgs(argv: string[]): WorkerArgs {
  const out: WorkerArgs = {
    help: false,
    endpointPath: defaultEndpointPath(),
    maxConcurrentTasks: DEFAULT_MAX_TASKS,
    apoharaVersion: APOHARA_VERSION,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--help":
      case "-h":
        out.help = true;
        return out;
      case "--endpoint": {
        const v = argv[++i];
        if (!v) {
          return { ...out, error: { code: "MISSING_VALUE", message: "--endpoint requires a path" } };
        }
        out.endpointPath = v;
        break;
      }
      case "--key": {
        const v = argv[++i];
        if (!v) {
          return { ...out, error: { code: "MISSING_VALUE", message: "--key requires a path" } };
        }
        out.keyPath = v;
        break;
      }
      case "--max-tasks": {
        const v = argv[++i];
        const n = Number.parseInt(v ?? "", 10);
        if (!Number.isFinite(n) || n < 1) {
          return {
            ...out,
            error: {
              code: "INVALID_MAX_TASKS",
              message: `--max-tasks must be a positive integer, got ${JSON.stringify(v)}`,
            },
          };
        }
        out.maxConcurrentTasks = n;
        break;
      }
      default:
        return { ...out, error: { code: "UNKNOWN_FLAG", message: `unknown flag ${a}` } };
    }
  }
  return out;
}

export function isFeatureEnabled(env: Partial<NodeJS.ProcessEnv>): boolean {
  return env.APOHARA_REMOTE_WORKERS === "1";
}

export function loadEndpoint(path: string): WorkerEndpoint | { error: { code: string; message: string } } {
  if (!existsSync(path)) {
    return {
      error: {
        code: "ENDPOINT_NOT_FOUND",
        message: `endpoint file not found at ${path}; is the daemon running with APOHARA_REMOTE_WORKERS=1?`,
      },
    };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as WorkerEndpoint;
    if (parsed.host !== "127.0.0.1") {
      return {
        error: {
          code: "INVALID_ENDPOINT_HOST",
          message: `endpoint host must be 127.0.0.1, got ${parsed.host}`,
        },
      };
    }
    if (typeof parsed.port !== "number" || parsed.port <= 0 || parsed.port > 65535) {
      return {
        error: {
          code: "INVALID_ENDPOINT_PORT",
          message: `endpoint port out of range: ${parsed.port}`,
        },
      };
    }
    return parsed;
  } catch (e) {
    return {
      error: {
        code: "ENDPOINT_PARSE_ERROR",
        message: `failed to parse endpoint at ${path}: ${(e as Error).message}`,
      },
    };
  }
}

export async function runWorkerCommand(
  opts: WorkerCommandOptions,
): Promise<WorkerCommandResult> {
  const parsed = parseWorkerArgs(opts.args);
  if (parsed.help) {
    return { exitCode: 0, help: true };
  }
  if (parsed.error) {
    return { exitCode: 2, error: parsed.error };
  }
  if (!isFeatureEnabled(opts.env)) {
    return {
      exitCode: 2,
      error: {
        code: "FEATURE_DISABLED",
        message:
          "apohara worker is gated behind APOHARA_REMOTE_WORKERS=1; set it on the daemon AND the worker process",
      },
    };
  }

  const endpointPath = parsed.endpointPath ?? defaultEndpointPath();
  const ep = loadEndpoint(endpointPath);
  if ("error" in ep) {
    return { exitCode: 2, error: ep.error };
  }
  // Real SSH connect/handshake/run-loop lands in G6.C.5..7. Until then we just
  // report success of the discovery phase so the CLI is wired and tested.
  return { exitCode: 0, endpoint: ep };
}
