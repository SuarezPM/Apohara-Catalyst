/**
 * Tests for memory injection utilities
 */

import { describe, expect, test } from "bun:test";
import type { Memory } from "../src/core/indexer-client";
import {
	fetchAndFormatMemories,
	formatMemoryBlock,
	injectMemoriesIntoPrompt,
} from "../src/core/memory-injection";

describe("formatMemoryBlock", () => {
	test("returns empty string for empty memories", () => {
		const result = formatMemoryBlock([]);
		expect(result).toBe("");
	});

	test("formats single memory correctly", () => {
		const memories: Memory[] = [
			{
				id: "test-1",
				memory_type: "preference",
				content: "User prefers snake_case",
				created_at: 1234567890,
				similarity: 0.95,
			},
		];

		const result = formatMemoryBlock(memories);
		expect(result).toBe(
			'<apohara_memory>\n  <memory type="preference">User prefers snake_case</memory>\n</apohara_memory>',
		);
	});

	test("formats multiple memories", () => {
		const memories: Memory[] = [
			{
				id: "test-1",
				memory_type: "preference",
				content: "Prefer snake_case",
				created_at: 1,
				similarity: 0.95,
			},
			{
				id: "test-2",
				memory_type: "architecture",
				content: "Use redb",
				created_at: 2,
				similarity: 0.85,
			},
		];

		const result = formatMemoryBlock(memories);
		expect(result).toContain(
			'<memory type="preference">Prefer snake_case</memory>',
		);
		expect(result).toContain('<memory type="architecture">Use redb</memory>');
		expect(result).toContain("<apohara_memory>");
		expect(result).toContain("</apohara_memory>");
	});

	test("escapes XML special characters", () => {
		const memories: Memory[] = [
			{
				id: "test-1",
				memory_type: "preference",
				content: 'Use "double quotes" & <angle brackets>',
				created_at: 1,
				similarity: 0.9,
			},
		];

		const result = formatMemoryBlock(memories);
		expect(result).toContain("&quot;double quotes&quot;");
		expect(result).toContain("&amp;");
		expect(result).toContain("&lt;angle brackets&gt;");
	});

	test("handles all memory types", () => {
		const types = [
			"correction",
			"preference",
			"architecture",
			"past_error",
		] as const;

		for (const type of types) {
			const memories: Memory[] = [
				{
					id: `test-${type}`,
					memory_type: type,
					content: `Test ${type}`,
					created_at: 1,
					similarity: 0.9,
				},
			];

			const result = formatMemoryBlock(memories);
			expect(result).toContain(`type="${type}"`);
		}
	});
});

describe("injectMemoriesIntoPrompt", () => {
	test("returns base prompt unchanged when no memories", () => {
		const basePrompt = "You are a helpful assistant.";
		const result = injectMemoriesIntoPrompt(basePrompt, []);
		expect(result).toBe(basePrompt);
	});

	test("injects memories into single-line prompt", () => {
		const basePrompt = "You are a helpful assistant.";
		const memories: Memory[] = [
			{
				id: "test-1",
				memory_type: "preference",
				content: "Use snake_case",
				created_at: 1,
				similarity: 0.9,
			},
		];

		const result = injectMemoriesIntoPrompt(basePrompt, memories);
		expect(result).toContain("You are a helpful assistant.");
		expect(result).toContain("<apohara_memory>");
		expect(result).toContain("Use snake_case");
	});

	test("injects memories after first line in multi-line prompt", () => {
		const basePrompt =
			"You are a helpful assistant.\n\nFollow these guidelines.";
		const memories: Memory[] = [
			{
				id: "test-1",
				memory_type: "architecture",
				content: "Use repository pattern",
				created_at: 1,
				similarity: 0.95,
			},
		];

		const result = injectMemoriesIntoPrompt(basePrompt, memories);
		expect(result).toContain("You are a helpful assistant.");
		expect(result).toContain("<apohara_memory>");
		expect(result).toContain("Use repository pattern");
		expect(result).toContain("Follow these guidelines");
	});

	test("preserves all content from base prompt", () => {
		const basePrompt = "Line 1\nLine 2\nLine 3\nLine 4";
		const memories: Memory[] = [
			{
				id: "test-1",
				memory_type: "preference",
				content: "Test",
				created_at: 1,
				similarity: 0.9,
			},
		];

		const result = injectMemoriesIntoPrompt(basePrompt, memories);
		expect(result).toContain("Line 1");
		expect(result).toContain("Line 2");
		expect(result).toContain("Line 3");
		expect(result).toContain("Line 4");
	});
});

describe("fetchAndFormatMemories", () => {
	test("fetches and formats memories successfully", async () => {
		const mockMemories: Memory[] = [
			{
				id: "test-1",
				memory_type: "preference",
				content: "Use snake_case",
				created_at: 1,
				similarity: 0.95,
			},
		];

		const mockSearch = async (
			_query: string,
			_topK: number,
		): Promise<Memory[]> => {
			return mockMemories;
		};

		const result = await fetchAndFormatMemories("test query", mockSearch);
		expect(result).toContain("<apohara_memory>");
		expect(result).toContain("Use snake_case");
	});

	test("returns empty string when search returns empty", async () => {
		const mockSearch = async (): Promise<Memory[]> => [];
		const result = await fetchAndFormatMemories("test query", mockSearch);
		expect(result).toBe("");
	});

	test("returns empty string on search error (graceful degradation)", async () => {
		const mockSearch = async (): Promise<Memory[]> => {
			throw new Error("Connection failed");
		};

		// Should not throw, should return empty string
		const result = await fetchAndFormatMemories("test query", mockSearch);
		expect(result).toBe("");
	});

	test("passes correct parameters to search function", async () => {
		let receivedQuery: string | undefined;
		let receivedTopK: number | undefined;

		const mockSearch = async (
			query: string,
			topK: number,
		): Promise<Memory[]> => {
			receivedQuery = query;
			receivedTopK = topK;
			return [];
		};

		await fetchAndFormatMemories("my query", mockSearch);
		expect(receivedQuery).toBe("my query");
		expect(receivedTopK).toBe(5);
	});
});
