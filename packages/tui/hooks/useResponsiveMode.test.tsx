import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useResponsiveMode } from "./useResponsiveMode.tsx";

describe("useResponsiveMode", () => {
	let listeners: Map<string, Set<() => void>>;

	beforeEach(() => {
		listeners = new Map();
		vi.spyOn(process.stdout, "on").mockImplementation(
			(event: string | symbol, fn: () => void) => {
				if (!listeners.has(event as string))
					listeners.set(event as string, new Set());
				listeners.get(event as string)!.add(fn);
				return process.stdout;
			},
		);
		vi.spyOn(process.stdout, "off").mockImplementation(
			(event: string | symbol, fn: () => void) => {
				listeners.get(event as string)?.delete(fn);
				return process.stdout;
			},
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function setColumns(cols: number) {
		Object.defineProperty(process.stdout, "columns", {
			value: cols,
			configurable: true,
			writable: true,
		});
	}

	function emitResize() {
		act(() => {
			listeners.get("resize")?.forEach((fn) => fn());
		});
	}

	it("returns 'normal' when columns >= 100", () => {
		setColumns(120);
		const { result } = renderHook(() => useResponsiveMode());
		expect(result.current).toBe("normal");
	});

	it("returns 'compact' when columns between 60 and 99", () => {
		setColumns(80);
		const { result } = renderHook(() => useResponsiveMode());
		expect(result.current).toBe("compact");
	});

	it("returns 'minimal' when columns < 60", () => {
		setColumns(40);
		const { result } = renderHook(() => useResponsiveMode());
		expect(result.current).toBe("minimal");
	});

	it("updates mode on resize", () => {
		setColumns(120);
		const { result } = renderHook(() => useResponsiveMode());
		expect(result.current).toBe("normal");

		setColumns(50);
		emitResize();
		expect(result.current).toBe("minimal");
	});

	it("registers and unregisters resize listener", () => {
		const { unmount } = renderHook(() => useResponsiveMode());
		expect(listeners.get("resize")?.size).toBe(1);

		unmount();
		expect(listeners.get("resize")?.size).toBe(0);
	});
});
