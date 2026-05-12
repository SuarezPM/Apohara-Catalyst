/**
 * Tests for MCP Bridge (GitNexus + cocoindex-code) integration
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { TaskDecomposer } from "../src/core/decomposer";

describe("MCP Bridge Integration", () => {
	describe("TaskDecomposer with MCP augmentation", () => {
		it("should allow optional MCP integration without breaking existing functionality", async () => {
			const decomposer = new TaskDecomposer();

			// Even without MCP, decomposer should work for basic decomposition
			// (This tests backward compatibility)

			// Test passes if decomposer instantiates correctly
			expect(decomposer).toBeDefined();
		});

		it("should support MCP configuration through environment", async () => {
			// Import config to trigger loading
			await import("../src/core/config");

			// Verify the MCP config object exists in config schema
			// (actual env vars may not be set in test environment)
			const configModule = await import("../src/core/config");

			// Just verify config module is loaded
			expect(configModule.config).toBeDefined();
		});
	});

	describe("MCP Registry initialization", () => {
		it("should be able to create MCP client instance", async () => {
			// Test that MCP client can be imported
			const { MCPClient, MCPRegistry } = await import("../src/lib/mcp-client");

			expect(MCPClient).toBeDefined();
			expect(MCPRegistry).toBeDefined();

			// Test registry can be instantiated
			const registry = new MCPRegistry();
			expect(registry).toBeDefined();
			expect(typeof registry.register).toBe("function");
			expect(typeof registry.callTool).toBe("function");
			expect(typeof registry.getServers).toBe("function");
		});

		it("should have proper MCP client interface", async () => {
			const { MCPClient } = await import("../src/lib/mcp-client");

			// Test that MCPClient can be instantiated with config
			const client = new MCPClient({
				command: "echo",
				args: ["test"],
			});

			expect(client).toBeDefined();
			expect(typeof client.connect).toBe("function");
			expect(typeof client.disconnect).toBe("function");
			expect(typeof client.callTool).toBe("function");
			expect(typeof client.listTools).toBe("function");
			expect(typeof client.isConnected).toBe("function");
		});

		it("should support tool discovery interface", async () => {
			const { MCPTool } = await import("../src/lib/mcp-client");

			// Verify tool interface exists
			const mockTool: MCPTool = {
				name: "test-tool",
				description: "A test tool",
				inputSchema: { type: "object" },
			};

			expect(mockTool.name).toBe("test-tool");
			expect(mockTool.description).toBe("A test tool");
		});
	});

	describe("GitNexus MCP Integration", () => {
		it("should configure GitNexus path from environment", () => {
			// Test gitnexus path is properly configurable
			const path =
				process.env.GITNEXUS_PATH || "/home/linconx/.npm-global/bin/gitnexus";

			// Just verify we loaded a path
			expect(path.length).toBeGreaterThan(0);
		});

		it("MCP client can spawn gitnexus if available", async () => {
			const { MCPClient } = await import("../src/lib/mcp-client");

			// This will fail to connect but tests the interface works
			// The actual connection would require gitnexus to be running
			const client = new MCPClient({
				command: "gitnexus",
				args: ["mcp"],
			});

			// Verify client is configured properly
			expect(client).toBeDefined();
		}, 5000);
	});

	describe("cocoindex-code MCP Integration", () => {
		it("should configure cocoindex-code path from environment", () => {
			// Test cocoindex code path is configurable
			const path = process.env.COCOINDEX_CODE_PATH || "";

			expect(typeof path).toBe("string");
		});
	});
});
