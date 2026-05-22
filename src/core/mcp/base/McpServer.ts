import { TokenBucket, DEFAULT_RATE_LIMITS, type RateLimitConfig } from "./rateLimit.js";
import { AuditLogger, type AuditEntry } from "./auditLogger.js";

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
    // Bearer auth gate
    const auth = req.headers.get("authorization") ?? "";
    if (!auth.startsWith("Bearer ") || auth.slice(7) !== this.config.bearerToken) {
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
      body = (await req.json()) as { tool?: string; input?: Record<string, unknown> };
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
      await this.logEntry({ server: this.config.serverName, tool: body.tool, status: "error", detail: String(e) });
      return Response.json({ error: String(e) }, { status: 500 });
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
