import { type LLMMessage, ProviderRouter } from "../providers/router";
import { routeTaskWithFallback } from "./agent-router";
import type { IndexerClient, SearchResult } from "./indexer-client";
import { EventLedger } from "./ledger";
import { fetchAndFormatMemories } from "./memory-injection";
import type { TaskRole } from "./types";

// Dynamic import for MCP client to avoid build issues when not available
let mcpRegistry: any = null;

async function getMCPRegistry() {
	if (!mcpRegistry) {
		try {
			const { mcpRegistry: registry } = await import("../lib/mcp-client");
			mcpRegistry = registry;
		} catch {
			// MCP client not available
		}
	}
	return mcpRegistry;
}

export interface IndexerContext {
	/** Semantically relevant files/functions found via broad prompt search */
	searchHits: Array<{
		filePath: string;
		functionName: string;
		line: number;
		score: number;
	}>;
	/** Transitively affected files based on this task's primary target */
	blastRadius: string[];
}

export interface DecomposedTask {
	id: string;
	description: string;
	estimatedComplexity: "low" | "medium" | "high";
	dependencies: string[];
	role: TaskRole;
	files?: string[];
	/** Indexer-derived context injected at orchestration layer. Agents receive this as-is. */
	indexerContext?: IndexerContext;
}

export interface DecompositionResult {
	tasks: DecomposedTask[];
	originalPrompt: string;
}

export class TaskDecomposer {
	private router: ProviderRouter;
	private indexerClient: IndexerClient | null;
	private ledger: EventLedger;

	constructor(router?: ProviderRouter, indexerClient?: IndexerClient | null) {
		this.router = router || new ProviderRouter();
		this.ledger = new EventLedger();
		// null explicitly disables indexer (useful in tests); undefined triggers lazy default import
		if (indexerClient !== undefined) {
			this.indexerClient = indexerClient;
		} else {
			// Lazy-load the default singleton to avoid import-time side effects in tests
			this.indexerClient = null;
			import("./indexer-client")
				.then(({ indexerClient: client }) => {
					this.indexerClient = client;
				})
				.catch(() => {
					// indexer-client not available
				});
		}
	}

	/**
	 * Decomposes a high-level prompt into atomic tasks using an LLM.
	 */
	public async decompose(prompt: string): Promise<DecompositionResult> {
		// Fetch relevant memories for cognitive injection
		const memoryBlock = await this.fetchMemoryBlock(prompt);

		const messages: LLMMessage[] = [
			{
				role: "system",
				content: `You are a task decomposition engine. Given a user request, break it down into atomic, actionable tasks.
${memoryBlock}
Output format: Return a JSON object with a "tasks" array. Each task must have:
- id: A short kebab-case identifier (e.g., "setup-deps", "impl-core")
- description: Clear description of what to do
- estimatedComplexity: "low", "medium", or "high"
- dependencies: Array of task IDs that must complete before this one
- role: One of "research", "planning", "execution", or "verification". 
  - "research": Tasks that gather information, search docs, or explore codebase
  - "planning": Tasks that decompose milestones, create plans, or design architecture
  - "execution": Tasks that implement code, write files, or modify the codebase
  - "verification": Tasks that test, review, audit, or validate implementations
- files: Array of file paths likely to be created or modified (e.g., "src/main.ts", "tests/integration.test.ts"). Be specific but reasonable. Empty array if no files needed.

Rules:
- Tasks should be independently implementable when dependencies are met
- Prefer many small tasks over few large ones
- Include setup, implementation, and verification tasks
- Dependencies must reference valid task IDs

Example:
{
  "tasks": [
    {
      "id": "setup-project",
      "description": "Initialize project structure and dependencies",
      "estimatedComplexity": "low",
      "dependencies": [],
      "role": "execution",
      "files": ["package.json", "tsconfig.json", "src/index.ts"]
    },
    {
      "id": "impl-core",
      "description": "Implement the core functionality",
      "estimatedComplexity": "high",
      "dependencies": ["setup-project"],
      "role": "execution",
      "files": ["src/core/handler.ts", "src/types.ts"]
    }
  ]
}`,
			},
			{
				role: "user",
				content: `Decompose this request into tasks: ${prompt}`,
			},
		];

		// Use agent-router for role-based provider selection
		// Decomposition is a "planning" task, which maps to Gemini
		const result = await routeTaskWithFallback(
			"planning",
			{ messages },
			this.router,
		);
		const response = result.response;

		// Parse the LLM response - it should be JSON
		let parsed: { tasks: DecomposedTask[] };
		try {
			// Try to extract JSON from the response (LLM might wrap it in markdown)
			const content = response.content.trim();
			const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) ||
				content.match(/```\s*([\s\S]*?)```/) || [null, content];
			const jsonStr = jsonMatch[1] || content;
			parsed = JSON.parse(jsonStr) as { tasks: DecomposedTask[] };
		} catch (_error) {
			throw new Error(
				`Failed to parse LLM decomposition response: ${response.content}`,
			);
		}

		// Validate the structure
		if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
			throw new Error("Invalid decomposition: missing tasks array");
		}

		// Validate dependencies reference existing tasks
		const taskIds = new Set(parsed.tasks.map((t) => t.id));
		for (const task of parsed.tasks) {
			for (const dep of task.dependencies) {
				if (!taskIds.has(dep)) {
					throw new Error(`Task ${task.id} has invalid dependency: ${dep}`);
				}
			}
			// Default role to "execution" if not provided (backwards compatibility)
			if (!task.role) {
				task.role = "execution";
			}
			// Validate role is a valid TaskRole
			if (
				!["research", "planning", "execution", "verification"].includes(
					task.role,
				)
			) {
				task.role = "execution";
			}
			// Handle estimated files gracefully - default to empty array if missing or invalid
			if (!task.files || !Array.isArray(task.files)) {
				task.files = [];
			}
			// Map estimatedFiles to files if LLM uses different field name
			if ((task as any).estimatedFiles && !task.files?.length) {
				task.files = (task as any).estimatedFiles;
			}
		}

		// Detect dependency cycles using DFS
		const cycle = this.detectCycle(parsed.tasks);
		if (cycle) {
			throw new Error(
				`Dependency cycle detected: ${cycle.join(" -> ")}. ` +
					"Please ensure dependencies form a DAG (Directed Acyclic Graph).",
			);
		}

		// Inject indexer context — one broad search over the prompt, then per-task blast radius
		parsed.tasks = await this.injectIndexerContext(parsed.tasks, prompt);

		// Enhance file estimation using MCP (GitNexus + cocoindex-code) if available
		parsed.tasks = await this.enhanceWithMCP(parsed.tasks, prompt);

		return {
			tasks: parsed.tasks,
			originalPrompt: prompt,
		};
	}

	/**
	 * Fetches relevant memories and formats them for cognitive injection.
	 * Returns empty string if indexer unavailable or no memories found.
	 */
	private async fetchMemoryBlock(prompt: string): Promise<string> {
		if (!this.indexerClient) {
			return "";
		}

		try {
			return await fetchAndFormatMemories(
				prompt,
				this.indexerClient.searchMemory.bind(this.indexerClient),
			);
		} catch (error) {
			// Graceful degradation - log and continue without memories
			await this.ledger.log(
				"memory_injection_skipped",
				{ reason: "fetch_failed", error: (error as Error).message },
				"warning",
			);
			return "";
		}
	}

	/**
	 * Injects indexer-derived context into each task.
	 * Performs one broad semantic search over the prompt, then fetches blast radius
	 * per task based on the task's primary file target.
	 * Fails gracefully — if the daemon is unreachable, tasks are returned unchanged.
	 */
	private async injectIndexerContext(
		tasks: DecomposedTask[],
		prompt: string,
	): Promise<DecomposedTask[]> {
		const client = this.indexerClient;
		if (!client) {
			return tasks;
		}

		let searchHits: SearchResult[] = [];
		let injectedCount = 0;
		const startMs = Date.now();

		try {
			// One broad search over the full prompt — shared across all tasks
			searchHits = await client.search(prompt, 10);
		} catch (err) {
			// Daemon unreachable or search failed — degrade gracefully
			await this.ledger.log(
				"indexer_context_skipped",
				{ reason: "search_failed", error: (err as Error).message },
				"warning",
			);
			return tasks;
		}

		const mappedHits = searchHits.map((hit) => ({
			filePath: hit.metadata.file_path,
			functionName: hit.metadata.function_name,
			line: hit.metadata.line,
			score: 1 - hit.distance, // distance → similarity score
		}));

		// Per-task blast radius using the task's primary file target
		for (const task of tasks) {
			const primaryTarget = task.files?.[0];
			let blastRadius: string[] = [];

			if (primaryTarget) {
				try {
					const result = await client.getBlastRadius(primaryTarget);
					blastRadius = result.files;
				} catch {
					// Blast radius unavailable for this target — leave empty
				}
			}

			task.indexerContext = {
				searchHits: mappedHits,
				blastRadius,
			};
			injectedCount++;
		}

		await this.ledger.log(
			"indexer_context_injected",
			{
				prompt: prompt.slice(0, 120),
				searchHits: mappedHits.length,
				tasksEnriched: injectedCount,
				durationMs: Date.now() - startMs,
			},
			"info",
		);

		return tasks;
	}

	/**
	 * Enhances task file estimates using MCP servers.
	 * Uses GitNexus for code graph analysis and cocoindex-code for semantic search.
	 */
	private async enhanceWithMCP(
		tasks: DecomposedTask[],
		prompt: string,
	): Promise<DecomposedTask[]> {
		const registry = await getMCPRegistry();

		if (!registry) {
			console.log(
				"[TaskDecomposer] MCP not available, using LLM estimates only",
			);
			return tasks;
		}

		console.log("[TaskDecomposer] Enhancing with MCP...");

		// Try to get more accurate file estimates from GitNexus (code graph)
		try {
			const gitnexusTools = await registry.listTools("gitnexus");
			if (gitnexusTools.length > 0) {
				console.log(
					`[TaskDecomposer] GitNexus MCP available with ${gitnexusTools.length} tools`,
				);

				// Try to call a tool that might estimate affected files
				// This is a best-effort enhancement - we try but don't fail if it doesn't work
			}
		} catch (err) {
			console.log(
				`[TaskDecomposer] GitNexus MCP error: ${(err as Error).message}`,
			);
		}

		// Try semantic search via cocoindex-code
		try {
			const cocoTools = await registry.listTools("cocoindex-code");
			if (cocoTools.length > 0) {
				console.log(
					`[TaskDecomposer] cocoindex-code MCP available with ${cocoTools.length} tools`,
				);

				// Use semantic search to find relevant files in the codebase
				try {
					const searchResults = await registry.callTool(
						"cocoindex-code",
						"semantic_search",
						{
							query: prompt,
							limit: 10,
						},
					);
					if (
						searchResults &&
						Array.isArray(searchResults) &&
						searchResults.length > 0
					) {
						console.log(
							`[TaskDecomposer] Found ${searchResults.length} relevant files via semantic search`,
						);

						// Add relevant files to execution tasks that don't have file estimates yet
						const relevantFiles = searchResults
							.map((r: any) => r.file_path || r.path || r.file)
							.filter(Boolean);

						for (const task of tasks) {
							// Only enhance execution tasks that have empty or minimal file estimates
							if (
								task.role === "execution" &&
								(!task.files || task.files.length < 2)
							) {
								// Only add files that aren't already in the estimate
								const newFiles = relevantFiles
									.filter((f: string) => !task.files?.includes(f))
									.slice(0, 3); // Add up to 3 relevant files

								if (newFiles.length > 0) {
									task.files = [...(task.files || []), ...newFiles];
									console.log(
										`[TaskDecomposer] Enhanced ${task.id} with ${newFiles.length} files from semantic search`,
									);
								}
							}
						}
					}
				} catch (searchErr) {
					console.log(
						`[TaskDecomposer] Semantic search error: ${(searchErr as Error).message}`,
					);
				}
			}
		} catch (err) {
			console.log(
				`[TaskDecomposer] cocoindex-code MCP error: ${(err as Error).message}`,
			);
		}

		return tasks;
	}

	/**
	 * Detects cycles in the dependency graph using DFS.
	 * Returns the cyclic path if a cycle is found, otherwise null.
	 */
	private detectCycle(tasks: DecomposedTask[]): string[] | null {
		const graph = new Map<string, string[]>();
		for (const task of tasks) {
			graph.set(task.id, task.dependencies);
		}

		const visited = new Set<string>();
		const recursionStack = new Set<string>();
		const path: string[] = [];

		const dfs = (taskId: string, currentPath: string[]): string[] | null => {
			visited.add(taskId);
			recursionStack.add(taskId);
			currentPath.push(taskId);

			const deps = graph.get(taskId) || [];
			for (const dep of deps) {
				if (!visited.has(dep)) {
					const cycle = dfs(dep, currentPath);
					if (cycle) return cycle;
				} else if (recursionStack.has(dep)) {
					// Found a cycle - return path from the cycle start to the end
					const cycleStart = currentPath.indexOf(dep);
					return [...currentPath.slice(cycleStart), dep];
				}
			}

			recursionStack.delete(taskId);
			currentPath.pop();
			return null;
		};

		for (const task of tasks) {
			if (!visited.has(task.id)) {
				const cycle = dfs(task.id, []);
				if (cycle) return cycle;
			}
		}

		return null;
	}
}
