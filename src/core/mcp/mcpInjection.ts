/**
 * MCP config injection per spec §8.8.
 *
 * Given canonical MCP config + a target provider, writes a provider-native
 * dialect to the workspace's expected path.
 *
 * Claude: workspace/.claude/mcp.json (JSON)
 * Codex:  workspace/.codex/config.toml (TOML)
 * OpenCode: workspace/.opencode/settings.json (JSON)
 *
 * Per §0.8 — every writer below goes through `atomicWriteFile` so a
 * crash mid-write cannot leave a half-baked config that breaks the
 * provider's next startup.
 */
import { atomicWriteFile } from "../persistence/atomicWrite.js";
import { join } from "node:path";
import type { McpCanonical, McpServerCanonical } from "./canonical.js";
import type { ProviderId } from "../providers/agent-config.js";

export interface InjectionResult {
	providerId: ProviderId;
	configPath: string;
	bytesWritten: number;
}

export async function injectMcpConfig(
	providerId: ProviderId,
	canonical: McpCanonical,
	workspacePath: string,
): Promise<InjectionResult> {
	switch (providerId) {
		case "claude-code-cli":
			return injectClaude(canonical, workspacePath);
		case "codex-cli":
			return injectCodex(canonical, workspacePath);
		case "opencode-go":
			return injectOpenCode(canonical, workspacePath);
		default:
			throw new Error(
				`unknown provider for MCP injection: ${providerId as string}`,
			);
	}
}

/**
 * TOML bare-key syntax allows only [A-Za-z0-9_-]. Anything else MUST be
 * quoted. We use the quoted form whenever the key contains anything
 * non-bare; this keeps both server names and env-var keys safe even when
 * the caller passes characters that would otherwise break the document
 * structure (`.`, `[`, `]`, spaces, etc.).
 */
function tomlKey(name: string): string {
	if (/^[A-Za-z0-9_-]+$/.test(name)) return name;
	return JSON.stringify(name);
}

async function injectClaude(
	c: McpCanonical,
	workspace: string,
): Promise<InjectionResult> {
	const configPath = join(workspace, ".claude", "mcp.json");
	const mcpServers: Record<string, unknown> = {};
	for (const s of c.servers) {
		mcpServers[s.name] = {
			command: s.command,
			args: s.args ?? [],
			env: s.env ?? {},
		};
	}
	const content = `${JSON.stringify({ mcpServers }, null, 2)}\n`;
	await atomicWriteFile(configPath, content, { ensureParentDir: true });
	return {
		providerId: "claude-code-cli",
		configPath,
		bytesWritten: content.length,
	};
}

async function injectCodex(
	c: McpCanonical,
	workspace: string,
): Promise<InjectionResult> {
	const configPath = join(workspace, ".codex", "config.toml");
	let out = "";
	for (const s of c.servers) {
		out += `[mcp_servers.${tomlKey(s.name)}]\n`;
		out += `command = ${JSON.stringify(s.command)}\n`;
		out += `args = [${(s.args ?? []).map((a) => JSON.stringify(a)).join(", ")}]\n`;
		if (s.env && Object.keys(s.env).length > 0) {
			const pairs = Object.entries(s.env).map(
				([k, v]) => `${tomlKey(k)} = ${JSON.stringify(v)}`,
			);
			out += `env = { ${pairs.join(", ")} }\n`;
		}
		out += "\n";
	}
	await atomicWriteFile(configPath, out, { ensureParentDir: true });
	return { providerId: "codex-cli", configPath, bytesWritten: out.length };
}

async function injectOpenCode(
	c: McpCanonical,
	workspace: string,
): Promise<InjectionResult> {
	const configPath = join(workspace, ".opencode", "settings.json");
	const mcp: Record<string, unknown> = {};
	for (const s of c.servers) {
		mcp[s.name] = {
			type: s.type,
			command: s.command,
			args: s.args ?? [],
			env: s.env ?? {},
		};
	}
	const content = `${JSON.stringify({ mcp }, null, 2)}\n`;
	await atomicWriteFile(configPath, content, { ensureParentDir: true });
	return {
		providerId: "opencode-go",
		configPath,
		bytesWritten: content.length,
	};
}

export function buildCanonicalFromEndpoint(
	apoharaBin: string,
	token: string,
	servers: { ledger?: number; runs?: number; indexer?: number; settings?: number },
): McpCanonical {
	const out: McpServerCanonical[] = [];
	for (const [name, port] of Object.entries(servers)) {
		if (!port) continue;
		out.push({
			name: `apohara.${name}`,
			command: apoharaBin,
			args: ["mcp", "serve", name, "--port", String(port)],
			env: { APOHARA_MCP_TOKEN: token },
			type: "local",
		});
	}
	return { servers: out };
}
