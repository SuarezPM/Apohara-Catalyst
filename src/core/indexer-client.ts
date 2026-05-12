/**
 * TypeScript client for the apohara-indexer daemon.
 *
 * Provides:
 * - Auto-spawn of the daemon binary
 * - Unix Domain Socket connection
 * - JSON-RPC 2.0 request/response handling with line-delimited messages
 * - Reconnection logic with retry
 * - Typed methods for all RPC calls
 */

import * as child_process from "child_process";
import * as fs from "fs/promises";
import * as net from "net";
import * as os from "os";
import * as path from "path";

/**
 * Simple event emitter for the client
 */
class EventEmitter {
	private events: Record<string, ((...args: unknown[]) => void)[]> = {};

	public on(event: string, listener: (...args: unknown[]) => void): void {
		if (!this.events[event]) {
			this.events[event] = [];
		}
		this.events[event].push(listener);
	}

	public emit(event: string, ...args: unknown[]): void {
		const listeners = this.events[event] ?? [];
		for (const listener of listeners) {
			listener(...args);
		}
	}

	public once(event: string, listener: (...args: unknown[]) => void): void {
		const wrapper = (...args: unknown[]) => {
			listener(...args);
			this.off(event, wrapper);
		};
		this.on(event, wrapper);
	}

	public off(event: string, listener: (...args: unknown[]) => void): void {
		const listeners = this.events[event] ?? [];
		const idx = listeners.indexOf(listener);
		if (idx >= 0) {
			listeners.splice(idx, 1);
		}
	}

	public removeAllListeners(event?: string): void {
		if (event) {
			delete this.events[event];
		} else {
			this.events = {};
		}
	}
}

/** Socket path for the indexer daemon */
const DEFAULT_SOCKET_PATH = ".apohara/indexer.sock";

/** Path to the daemon binary */
const DEFAULT_BINARY_PATH =
	"crates/apohara-indexer/target/release/apohara-indexer";

/** Maximum reconnection attempts */
const MAX_RECONNECT_ATTEMPTS = 5;

/** Delay between reconnection attempts (ms) */
const RECONNECT_DELAY_MS = 1000;

/** Delay before checking if socket is ready after spawn (ms) */
const SOCKET_READY_DELAY_MS = 500;

/**
 * Get the resolved socket path (expands ~ to home directory, relative paths to cwd)
 */
function getSocketPath(): string {
	const cwd = process.cwd();
	const socketPath = DEFAULT_SOCKET_PATH;
	if (socketPath.startsWith("~/") || socketPath.startsWith("~\\")) {
		return path.join(os.homedir(), socketPath.slice(2));
	}
	if (!socketPath.startsWith("/") && !socketPath.match(/^[A-Za-z]:/)) {
		return path.join(cwd, socketPath);
	}
	return socketPath;
}

/**
 * Get the resolved binary path (absolute or relative to cwd)
 */
function getBinaryPath(): string {
	const cwd = process.cwd();
	const binaryPath = DEFAULT_BINARY_PATH;
	if (path.isAbsolute(binaryPath)) {
		return binaryPath;
	}
	return path.join(cwd, binaryPath);
}

/** JSON-RPC 2.0 request */
interface JsonRpcRequest {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
	id: number | string;
}

/** JSON-RPC 2.0 response */
interface JsonRpcResponse {
	jsonrpc: "2.0";
	result?: unknown;
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
	id: number | string;
}

/** Search result from indexer */
export interface SearchResult {
	id: number;
	distance: number;
	metadata: {
		file_path: string;
		function_name: string;
		parameters: string;
		return_type: string;
		line: number;
		column: number;
	};
}

/** Embedding response */
export interface EmbedResponse {
	embedding: number[];
}

/** Index file response */
export interface IndexFileResponse {
	ids: number[];
}

/** Blast radius response */
export interface BlastRadiusResponse {
	files: string[];
}

/** File signature (AST function/class signature) */
export interface FileSignature {
	name: string;
	parameters: string;
	return_type: string | null;
	line: number;
	column: number;
}

/** File signatures response */
export interface FileSignaturesResponse {
	file_path: string;
	signatures: FileSignature[];
}

/** Connection state */
export type ConnectionState =
	| "disconnected"
	| "connecting"
	| "connected"
	| "reconnecting";

// ============================================================================
// Memory Types
// ============================================================================

/** Types of memories stored in the system */
export type MemoryType =
	| "correction"
	| "preference"
	| "architecture"
	| "past_error";

/** Memory entry returned from search */
export interface Memory {
	/** Unique identifier (UUID) */
	id: string;
	/** Type of memory */
	memory_type: MemoryType;
	/** Content of the memory (text) */
	content: string;
	/** Timestamp when created */
	created_at: number;
	/** Similarity score from search (0-1, higher = more relevant) */
	similarity: number;
}

/** Response from store_memory RPC */
export interface StoreMemoryResponse {
	/** UUID of the stored memory */
	memory_id: string;
	/** Status of the operation */
	status: "stored";
}

/** Response from search_memory RPC */
export interface SearchMemoryResponse {
	/** Array of matching memories */
	memories: Memory[];
	/** Number of memories returned */
	count: number;
}

/**
 * Event emitter for indexer client events
 */
export class IndexerClient extends EventEmitter {
	private socketPath: string;
	private binaryPath: string;
	private socket: net.Socket | null = null;
	// Stored as the broader ChildProcess because the daemon is spawned with
	// `stdio: "ignore"` — its streams are null at runtime, which only the
	// non-`WithoutNullStreams` variant models.
	private process: child_process.ChildProcess | null = null;
	private state: ConnectionState = "disconnected";
	private requestId = 0;
	private pendingRequests = new Map<
		number | string,
		{ resolve: (value: unknown) => void; reject: (reason: unknown) => void }
	>();
	private reconnectAttempts = 0;
	private reconnectTimer: NodeJS.Timeout | null = null;
	private connectResolver: ((value: boolean) => void) | null = null;
	private lastError: Error | null = null;

	constructor(options?: { socketPath?: string; binaryPath?: string }) {
		super();
		this.socketPath = options?.socketPath ?? getSocketPath();
		this.binaryPath = options?.binaryPath ?? getBinaryPath();
	}

	/**
	 * Get current connection state
	 */
	public getState(): ConnectionState {
		return this.state;
	}

	/**
	 * Get last error
	 */
	public getLastError(): Error | null {
		return this.lastError;
	}

	/**
	 * Connect to the daemon, spawning it if necessary
	 */
	public async connect(): Promise<boolean> {
		if (this.state === "connected" || this.state === "connecting") {
			return this.state === "connected";
		}

		this.setState("connecting");

		// Check if socket exists and try to connect
		const socketExists = await this.checkSocketExists();

		if (!socketExists) {
			// Need to spawn the daemon
			this.emit("spawn", { binaryPath: this.binaryPath });
			await this.spawnDaemon();
		}

		// Try to connect
		return this.attemptConnection();
	}

	/**
	 * Check if socket file exists
	 */
	private async checkSocketExists(): Promise<boolean> {
		try {
			await fs.access(this.socketPath);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Spawn the daemon process
	 */
	private async spawnDaemon(): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				// Ensure the parent directory exists
				const socketDir = path.dirname(this.socketPath);
				fs.mkdir(socketDir, { recursive: true })
					.then(() => {
						this.process = child_process.spawn(this.binaryPath, [], {
							detached: true,
							stdio: "ignore",
						});

						this.process.on("error", (err) => {
							this.lastError = err;
							this.emit("error", err);
							reject(err);
						});

						// Wait for socket to become available
						setTimeout(() => {
							resolve();
						}, SOCKET_READY_DELAY_MS);
					})
					.catch(reject);
			} catch (err) {
				this.lastError = err instanceof Error ? err : new Error(String(err));
				reject(this.lastError);
			}
		});
	}

	/**
	 * Attempt to connect to the socket
	 */
	private attemptConnection(): Promise<boolean> {
		return new Promise((resolve) => {
			this.connectResolver = resolve;

			this.socket = net.createConnection(this.socketPath);

			this.socket.on("connect", () => {
				this.setState("connected");
				this.reconnectAttempts = 0;
				this.emit("connected");
				if (this.connectResolver) {
					this.connectResolver(true);
					this.connectResolver = null;
				}
			});

			this.socket.on("error", (err) => {
				this.lastError = err;
				this.emit("socket-error", err);

				if (this.state !== "reconnecting") {
					this.handleDisconnection();
				}

				if (this.connectResolver) {
					this.connectResolver(false);
					this.connectResolver = null;
				}
			});

			this.socket.on("close", () => {
				this.handleDisconnection();
			});

			this.socket.on("data", (data) => {
				this.handleData(data.toString());
			});
		});
	}

	/**
	 * Handle disconnection - attempt reconnection
	 */
	private handleDisconnection(): void {
		if (this.state === "connected" || this.state === "connecting") {
			this.setState("disconnected");
			this.emit("disconnected");
			this.scheduleReconnect();
		}
	}

	/**
	 * Schedule a reconnection attempt
	 */
	private scheduleReconnect(): void {
		if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
			this.emit("reconnect-failed", { attempts: this.reconnectAttempts });
			return;
		}

		this.reconnectAttempts++;
		this.setState("reconnecting");
		this.emit("reconnecting", { attempt: this.reconnectAttempts });

		this.reconnectTimer = setTimeout(async () => {
			await this.connect();
		}, RECONNECT_DELAY_MS * this.reconnectAttempts);
	}

	/**
	 * Set connection state
	 */
	private setState(newState: ConnectionState): void {
		this.state = newState;
		this.emit("state-change", newState);
	}

	/**
	 * Handle incoming data - parse JSON-RPC responses
	 */
	private handleData(data: string): void {
		const lines = data.split("\n").filter((line) => line.trim().length > 0);

		for (const line of lines) {
			try {
				const response: JsonRpcResponse = JSON.parse(line);
				const pending = this.pendingRequests.get(response.id);

				if (pending) {
					if (response.error) {
						pending.reject(
							new Error(
								`JSON-RPC error: ${response.error.message} (code: ${response.error.code})`,
							),
						);
					} else {
						pending.resolve(response.result);
					}
					this.pendingRequests.delete(response.id);
				}
			} catch (err) {
				this.emit("parse-error", { error: err, data: line });
			}
		}
	}

	/**
	 * Send a JSON-RPC request
	 */
	private async sendRequest(
		method: string,
		params?: unknown,
	): Promise<unknown> {
		if (this.state !== "connected") {
			const connected = await this.connect();
			if (!connected) {
				throw new Error("Failed to connect to indexer daemon");
			}
		}

		const id = ++this.requestId;
		const request: JsonRpcRequest = {
			jsonrpc: "2.0",
			method,
			params,
			id,
		};

		return new Promise((resolve, reject) => {
			if (!this.socket) {
				reject(new Error("Not connected"));
				return;
			}

			this.pendingRequests.set(id, { resolve, reject });

			this.socket.write(JSON.stringify(request) + "\n", (err) => {
				if (err) {
					this.pendingRequests.delete(id);
					reject(err);
				}
			});

			// Timeout for requests
			setTimeout(() => {
				if (this.pendingRequests.has(id)) {
					this.pendingRequests.delete(id);
					reject(new Error(`Request timeout: ${method}`));
				}
			}, 30000);
		});
	}

	/**
	 * Ping the daemon
	 */
	public async ping(params?: unknown): Promise<unknown> {
		return this.sendRequest("ping", params);
	}

	/**
	 * Request daemon shutdown
	 */
	public async shutdown(): Promise<unknown> {
		const result = await this.sendRequest("shutdown");
		// After shutdown, close our connection
		this.disconnect();
		return result;
	}

	/**
	 * Generate embedding for text
	 */
	public async embed(text: string): Promise<EmbedResponse> {
		const result = (await this.sendRequest("embed", { text })) as {
			embedding: number[];
		};
		return result;
	}

	/**
	 * Search the index
	 */
	public async search(query: string, k: number = 10): Promise<SearchResult[]> {
		const result = (await this.sendRequest("search", { query, k })) as {
			results: SearchResult[];
		};
		return result.results;
	}

	/**
	 * Index a file
	 */
	public async indexFile(filePath: string): Promise<IndexFileResponse> {
		const result = (await this.sendRequest("index_file", {
			path: filePath,
		})) as { ids: number[] };
		return result;
	}

	/**
	 * Get blast radius (transitive dependencies) for a target
	 */
	public async getBlastRadius(target: string): Promise<BlastRadiusResponse> {
		const result = (await this.sendRequest("get_blast_radius", { target })) as {
			files: string[];
		};
		return result;
	}

	/**
	 * Get file signatures (AST functions/classes) for a specific file
	 * Returns exact signatures without using semantic/vector search
	 */
	public async getFileSignatures(
		filePath: string,
	): Promise<FileSignaturesResponse> {
		const result = (await this.sendRequest("get_file_signatures", {
			file_path: filePath,
		})) as FileSignaturesResponse;
		return result;
	}

	/**
	 * Store a memory in the database
	 *
	 * @param content - Text content of the memory
	 * @param memoryType - Type of memory: "correction", "preference", "architecture", "past_error"
	 * @returns Promise resolving to the memory ID (UUID)
	 */
	public async storeMemory(
		content: string,
		memoryType: MemoryType,
	): Promise<string> {
		const result = (await this.sendRequest("store_memory", {
			content,
			memory_type: memoryType,
		})) as StoreMemoryResponse;
		return result.memory_id;
	}

	/**
	 * Search memories by semantic similarity
	 *
	 * @param query - Text query to search for
	 * @param topK - Maximum number of results to return (default: 5)
	 * @returns Promise resolving to array of memories with similarity scores
	 */
	public async searchMemory(
		query: string,
		topK: number = 5,
	): Promise<Memory[]> {
		const result = (await this.sendRequest("search_memory", {
			query,
			top_k: topK,
		})) as SearchMemoryResponse;
		return result.memories;
	}

	/**
	 * Disconnect from the daemon
	 */
	public disconnect(): void {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}

		if (this.socket) {
			this.socket.destroy();
			this.socket = null;
		}

		if (this.process && !this.process.killed) {
			// Try to kill the spawned daemon
			try {
				process.kill(-this.process.pid!);
			} catch {
				// Ignore if can't kill
			}
		}

		this.setState("disconnected");
		this.emit("disconnected");
	}

	/**
	 * Check if connected
	 */
	public isConnected(): boolean {
		return this.state === "connected";
	}
}

/**
 * Default client instance
 */
export const indexerClient = new IndexerClient();
