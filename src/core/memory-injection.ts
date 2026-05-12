/**
 * Memory injection utilities for system prompt enhancement.
 *
 * Provides functions to format memories as XML blocks for LLM injection.
 */

import type { Memory } from "./indexer-client";

/**
 * Format memories as an <apohara_memory> XML block.
 *
 * @param memories - Array of memories from search (already sorted by relevance)
 * @returns XML string or empty string if no memories
 *
 * Example output:
 * <apohara_memory>
 *   <memory type="architecture">System uses redb for embedded storage</memory>
 *   <memory type="preference">User prefers strict TypeScript interfaces</memory>
 * </apohara_memory>
 */
export function formatMemoryBlock(memories: Memory[]): string {
	if (memories.length === 0) {
		return "";
	}

	const memoryElements = memories
		.map((memory) => {
			// Escape XML special characters in content
			const escapedContent = escapeXml(memory.content);
			return `  <memory type="${memory.memory_type}">${escapedContent}</memory>`;
		})
		.join("\n");

	return `<apohara_memory>\n${memoryElements}\n</apohara_memory>`;
}

/**
 * Escape XML special characters.
 */
function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * Build a system prompt with memory injection.
 *
 * @param basePrompt - The base system prompt
 * @param memories - Array of memories (will be sorted by similarity if not already)
 * @returns Enhanced prompt with memory block inserted
 */
export function injectMemoriesIntoPrompt(
	basePrompt: string,
	memories: Memory[],
): string {
	const memoryBlock = formatMemoryBlock(memories);

	if (!memoryBlock) {
		return basePrompt;
	}

	// Insert memory block after the first line (typically the "You are..." statement)
	// or at the beginning if single line
	const lines = basePrompt.split("\n");

	if (lines.length === 1) {
		// Single line prompt - append memory block
		return `${basePrompt}\n\n${memoryBlock}`;
	}

	// Multi-line prompt - insert after first paragraph
	const firstLine = lines[0];
	const rest = lines.slice(1).join("\n");

	return `${firstLine}\n\n${memoryBlock}\n${rest}`;
}

/**
 * Search for relevant memories and format them for injection.
 *
 * This is a convenience function that combines search with formatting.
 *
 * @param query - The task description or query to search for
 * @param searchFn - Function to perform memory search (injected for testability)
 * @returns Formatted memory block or empty string if no results/error
 */
export async function fetchAndFormatMemories(
	query: string,
	searchFn: (query: string, topK: number) => Promise<Memory[]>,
): Promise<string> {
	try {
		const memories = await searchFn(query, 5);
		return formatMemoryBlock(memories);
	} catch (error) {
		// Graceful degradation - log warning and return empty
		console.warn("Failed to fetch memories:", error);
		return "";
	}
}
