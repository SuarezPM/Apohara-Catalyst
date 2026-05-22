import { timingSafeEqual } from "node:crypto";
import { TokenBucket, DEFAULT_RATE_LIMITS, type RateLimitConfig } from "./rateLimit.js";
import { AuditLogger, type AuditEntry } from "./auditLogger.js";
import { McpValidationError } from "./inputValidation.js";

/**
 * Constant-time bearer-token comparison. The short-circuit `!==` we
 * used previously leaks the matching prefix length via timing: an
 * attacker measuring the auth response time can recover the token one
 * byte at a time. `timingSafeEqual` requires equal-length buffers, so
 * we pad to the larger of the two lengths first so a wrong-length
 * guess can't be distinguished from a wrong-content guess either.
 */
function bearerEquals(provided: string, expected: string): boolean {
	const a = Buffer.from(provided, "utf-8");
	const b = Buffer.from(expected, "utf-8");
	const maxLen = Math.max(a.length, b.length);
	const padA = Buffer.alloc(maxLen);
	const padB = Buffer.alloc(maxLen);
	a.copy(padA);
	b.copy(padB);
	const equal = timingSafeEqual(padA, padB);
	return equal && a.length === b.length;
}

export type ToolHandler = (input: Record<string, unknown>) => Promise<unknown>;

export interface McpServerConfig {
  serverName: string;
  port: number;
  bearerToken: string;
  auditLogPath: string;
  rateLimits?: RateLimitConfig;
}

export interface ToolRegistration {
  name: string;
  handler: ToolHandler;
}

export interface RunningServer {
  bound: { hostname: string; port: number };
  stop(): Promise<void>;
}

export class McpServer {
  private tools = new Map<string, ToolHandler>();
  private bucket: TokenBucket;
  private audit: AuditLogger;

  constructor(private config: McpServerConfig) {
    this.bucket = new TokenBucket(config.rateLimits ?? DEFAULT_RATE_LIMITS);
    this.audit = new AuditLogger(config.auditLogPath);
  }

  register(tool: ToolRegistration): void {
    this.tools.set(tool.name, tool.handler);
  }

  start(): RunningServer {
    const server = Bun.serve({
      port: this.config.port,
      hostname: "127.0.0.1",
      fetch: async (req) => this.handle(req),
    });
    return {
      bound: { hostname: server.hostname, port: server.port },
      stop: async () => { server.stop(); },
    };
  }

  private async handle(req: Request): Promise<Response> {
    // Bearer auth gate (constant-time comparison — see bearerEquals).
    const auth = req.headers.get("authorization") ?? "";
    if (
      !auth.startsWith("Bearer ") ||
      !bearerEquals(auth.slice(7), this.config.bearerToken)
    ) {
      await this.logEntry({ server: this.config.serverName, tool: "<auth>", status: "denied" });
      return new Response("Unauthorized", { status: 401 });
    }

    // Rate limit gate
    if (!this.bucket.tryConsume()) {
      await this.logEntry({ server: this.config.serverName, tool: "<rate>", status: "rate_limited" });
      return new Response("Rate Limited", { status: 429 });
    }

    if (req.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let body: { tool?: string; input?: Record<string, unknown> };
    try {
      // Bounded body so a hostile client can't OOM the local MCP
      // server with a single huge JSON. 64 KiB is far more than any
      // realistic tool input.
      const buf = await req.arrayBuffer();
      if (buf.byteLength > 64 * 1024) {
        return new Response("Payload Too Large", { status: 413 });
      }
      body = JSON.parse(Buffer.from(buf).toString("utf-8")) as {
        tool?: string;
        input?: Record<string, unknown>;
      };
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!body.tool || !this.tools.has(body.tool)) {
      await this.logEntry({ server: this.config.serverName, tool: body.tool ?? "<unknown>", status: "denied", detail: "unknown tool" });
      return new Response("Unknown tool", { status: 404 });
    }

    try {
      const result = await this.tools.get(body.tool)!(body.input ?? {});
      await this.logEntry({ server: this.config.serverName, tool: body.tool, status: "ok" });
      return Response.json({ result });
    } catch (e) {
      // Map validation errors to HTTP 400 (client-fixable) so the caller
      // distinguishes "bad input" from a server-side fault.
      const status = e instanceof McpValidationError ? 400 : 500;
      await this.logEntry({
        server: this.config.serverName,
        tool: body.tool,
        status: "error",
        detail: String(e),
      });
      return Response.json({ error: String(e) }, { status });
    }
  }

  private async logEntry(entry: Omit<AuditEntry, "ts">): Promise<void> {
    try {
      await this.audit.log({ ts: Date.now(), ...entry });
    } catch {
      // audit failure is non-fatal
    }
  }
}
