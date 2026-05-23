import { expect, test } from "bun:test";
import { isYoloEnabled, type YoloGateContext } from "../../../src/core/orchestration/yolo-mode";

test("yolo disabled by default", () => {
	expect(isYoloEnabled({ env: {}, uiToggle: false, workspaceAllowed: false })).toBe(false);
});

test("yolo requires ALL three gates", () => {
	expect(isYoloEnabled({ env: { APOHARA_YOLO: "1" }, uiToggle: false, workspaceAllowed: false })).toBe(false);
	expect(isYoloEnabled({ env: { APOHARA_YOLO: "1" }, uiToggle: true, workspaceAllowed: false })).toBe(false);
	expect(isYoloEnabled({ env: { APOHARA_YOLO: "1" }, uiToggle: true, workspaceAllowed: true })).toBe(true);
});

test("APOHARA_YOLO=0 disables even if other gates pass", () => {
	expect(isYoloEnabled({ env: { APOHARA_YOLO: "0" }, uiToggle: true, workspaceAllowed: true })).toBe(false);
});

test("missing env var disables", () => {
	expect(isYoloEnabled({ env: {}, uiToggle: true, workspaceAllowed: true })).toBe(false);
});

// Avoid unused import warning by referencing the type at compile time via a helper.
const _typecheck: YoloGateContext = { env: {}, uiToggle: false, workspaceAllowed: false };
void _typecheck;
