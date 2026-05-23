/**
 * Tests for WSL detection + path conversion (G5.I.1).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	_resetWslCache,
	convertWslPath,
	detectWsl,
} from "../../../src/core/platform/wsl-detect";

describe("detectWsl", () => {
	beforeEach(() => {
		_resetWslCache();
	});

	afterEach(() => {
		_resetWslCache();
	});

	test("returns boolean without throwing on any platform", () => {
		// We can't mock /proc/version cleanly inside bun:test without filesystem
		// fixtures, so we just verify the contract: never throws, always boolean.
		const result = detectWsl();
		expect(typeof result).toBe("boolean");
	});

	test("caches result across calls", () => {
		const first = detectWsl();
		const second = detectWsl();
		expect(second).toBe(first);
	});
});

describe("convertWslPath to-windows", () => {
	test("converts /mnt/c/Users/foo to C:\\Users\\foo", () => {
		expect(convertWslPath("/mnt/c/Users/foo", "to-windows")).toBe(
			"C:\\Users\\foo",
		);
	});

	test("uppercases drive letter", () => {
		expect(convertWslPath("/mnt/d/projects/x", "to-windows")).toBe(
			"D:\\projects\\x",
		);
	});

	test("handles drive root /mnt/c", () => {
		expect(convertWslPath("/mnt/c", "to-windows")).toBe("C:");
	});

	test("handles drive root with trailing slash /mnt/c/", () => {
		expect(convertWslPath("/mnt/c/", "to-windows")).toBe("C:\\");
	});

	test("leaves non-mnt paths unchanged", () => {
		expect(convertWslPath("/home/pablo/x", "to-windows")).toBe("/home/pablo/x");
	});

	test("leaves empty string unchanged", () => {
		expect(convertWslPath("", "to-windows")).toBe("");
	});
});

describe("convertWslPath to-wsl", () => {
	test("converts C:\\Users\\foo to /mnt/c/Users/foo", () => {
		expect(convertWslPath("C:\\Users\\foo", "to-wsl")).toBe(
			"/mnt/c/Users/foo",
		);
	});

	test("converts C:/Users/foo (forward slashes) to /mnt/c/Users/foo", () => {
		expect(convertWslPath("C:/Users/foo", "to-wsl")).toBe("/mnt/c/Users/foo");
	});

	test("lowercases drive letter", () => {
		expect(convertWslPath("D:\\projects\\x", "to-wsl")).toBe(
			"/mnt/d/projects/x",
		);
	});

	test("leaves POSIX paths unchanged", () => {
		expect(convertWslPath("/home/pablo/x", "to-wsl")).toBe("/home/pablo/x");
	});

	test("leaves malformed paths unchanged", () => {
		expect(convertWslPath("not-a-path", "to-wsl")).toBe("not-a-path");
	});
});
