/**
 * MCP Client - Generic client for connecting to MCP servers
 * Supports stdio-based MCP servers like GitNexus and cocoindex-code
 */

import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";

export interface MCPTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface MCP的工具 {
	type: "call";
	name: string;
	arguments: Record<string, unknown>;
}

export interface MCPResponse {
	content: Array<{
		type: "text";
		text: string;
	}>;
}

export interface MCPConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

/**
 * Connects to an MCP server and provides tools
 */
export class MCPClient extends EventEmitter {
	private process: ChildProcess | null = null;
	private requestId = 0;
	private pendingRequests = new Map<
		string,
		{
			resolve: (value: unknown) => void;
			reject: (reason: unknown) => void;
		}
	>();
	private tools: Map<string, MCPTool> = new Map();
	private initialized = false;

	constructor(private config: MCPConfig) {
		super();
	}

	/**
	 * Initialize connection to MCP server
	 */
	async connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.process = spawn(this.config.command, this.config.args || [], {
				stdio: ["pipe", "pipe", "pipe"],
				env: { ...process.env, ...this.config.env },
			});

			this.process.stderr?.on("data", (data) => {
				this.emit("debug", data.toString());
			});

			this.process.on("error", (err) => {
				reject(err);
			});

			this.process.on("close", (code) => {
				this.emit("close", code);
			});

			// Initialize the connection
			this.sendRequest("initialize", {
				protocolVersion: "2024-11-05",
				capabilities: {},
				clientInfo: {
					name: "apohara",
					version: "1.0.0",
				},
			})
				.then(() => {
					this.initialized = true;
					resolve();
				})
				.catch(reject);
		});
	}

	/**
	 * List available tools from MCP server
	 */
	async listTools(): Promise<MCPTool[]> {
		const response = await this.sendRequest("tools/list", {});
		const tools = response.tools || [];
		this.tools.clear();
		for (const tool of tools) {
			this.tools.set(tool.name, tool);
		}
		return tools;
	}

	/**
	 * Call a specific tool on the MCP server
	 */
	async callTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<MCPResponse> {
		return this.sendRequest("tools/call", {
			name,
			arguments: args,
		});
	}

	/**
	 * Send a JSON-RPC request to the MCP server
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	private sendRequest(
		method: string,
		params: Record<string, unknown>,
	): Promise<any> {
		return new Promise((resolve, reject) => {
			if (!this.process?.stdin) {
				reject(new Error("MCP process not connected"));
				return;
			}

			const id = String(++this.requestId);
			const message = JSON.stringify({
				jsonrpc: "2.0",
				id,
				method,
				params,
			});

			this.pendingRequests.set(id, { resolve, reject });

			this.process.stdin.write(message + "\n");

			// Set a timeout
			setTimeout(() => {
				if (this.pendingRequests.has(id)) {
					this.pendingRequests.delete(id);
					reject(new Error(`MCP request ${id} timed out`));
				}
			}, 30000);
		});
	}

	/**
	 * Disconnect from MCP server
	 */
	disconnect(): void {
		if (this.process) {
			this.process.kill();
			this.process = null;
		}
		this.tools.clear();
		this.initialized = false;
	}

	/**
	 * Check if client is connected
	 */
	isConnected(): boolean {
		return this.initialized && this.process !== null;
	}

	/**
	 * Get tool by name
	 */
	getTool(name: string): MCPTool | undefined {
		return this.tools.get(name);
	}
}

/**
 * MCP Server Registry - manages multiple MCP server connections
 */
export class MCPRegistry {
	private clients = new Map<string, MCPClient>();
	private toolCache = new Map<string, MCPTool[]>();

	/**
	 * Register and connect to an MCP server
	 */
	async register(name: string, config: MCPConfig): Promise<void> {
		const client = new MCPClient(config);
		await client.connect();
		const tools = await client.listTools();

		this.clients.set(name, client);
		this.toolCache.set(name, tools);

		console.log(`[MCP] Registered ${name} with ${tools.length} tools`);
	}

	/**
	 * Call a tool on a specific MCP server
	 */
	async callTool(
		serverName: string,
		toolName: string,
		args: Record<string, unknown>,
	): Promise<MCPResponse> {
		const client = this.clients.get(serverName);
		if (!client) {
			throw new Error(`MCP server ${serverName} not registered`);
		}
		return client.callTool(toolName, args);
	}

	/**
	 * Find a tool across all registered servers by name
	 */
	findTool(toolName: string): { server: string; tool: MCPTool } | undefined {
		for (const [server, tools] of this.toolCache) {
			const tool = tools.find((t) => t.name === toolName);
			if (tool) {
				return { server, tool };
			}
		}
		return undefined;
	}

	/**
	 * Get all registered servers
	 */
	getServers(): string[] {
		return Array.from(this.clients.keys());
	}

	/**
	 * Disconnect all servers
	 */
	disconnectAll(): void {
		for (const client of this.clients.values()) {
			client.disconnect();
		}
		this.clients.clear();
		this.toolCache.clear();
	}
}

// Global registry instance
export const mcpRegistry = new MCPRegistry();
