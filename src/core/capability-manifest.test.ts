import { describe, expect, test } from "vitest";
import type { TaskType } from "./capability-manifest";
import {
	CAPABILITY_MANIFEST,
	getProviderCapability,
} from "./capability-manifest";
import type { TaskRole } from "./types";
import { ROLE_FALLBACK_ORDER } from "./types";

const ALL_TASK_TYPES: TaskType[] = [
	"research",
	"planning",
	"codegen",
	"debugging",
	"verification",
];
const ALL_ROLES: TaskRole[] = [
	"research",
	"planning",
	"execution",
	"verification",
];

describe("CAPABILITY_MANIFEST", () => {
	test("contains exactly 21 provider entries", () => {
		expect(CAPABILITY_MANIFEST.length).toBe(21);
	});

	test("all ProviderId values have a capability entry", () => {
		// Derive provider IDs from the manifest itself — source of truth
		const manifestIds = CAPABILITY_MANIFEST.map((c) => c.provider);
		// Every entry in the manifest must be findable via getProviderCapability
		for (const id of manifestIds) {
			const cap = getProviderCapability(id);
			expect(
				cap,
				`Expected capability entry for provider: ${id}`,
			).toBeDefined();
		}
	});

	test("every capability entry has all 5 task type scores between 0 and 1", () => {
		for (const entry of CAPABILITY_MANIFEST) {
			for (const taskType of ALL_TASK_TYPES) {
				const score = entry.scores[taskType];
				expect(
					typeof score,
					`${entry.provider}.scores.${taskType} should be a number`,
				).toBe("number");
				expect(
					score >= 0 && score <= 1,
					`${entry.provider}.scores.${taskType} (${score}) should be in [0, 1]`,
				).toBe(true);
			}
		}
	});

	test("every entry has non-empty sources array and a lastUpdated date", () => {
		for (const entry of CAPABILITY_MANIFEST) {
			expect(
				entry.sources.length,
				`${entry.provider} should have at least one source`,
			).toBeGreaterThan(0);
			expect(
				entry.lastUpdated,
				`${entry.provider} should have a lastUpdated date`,
			).toBeTruthy();
		}
	});
});

describe("ROLE_FALLBACK_ORDER", () => {
	test("has entries for all 4 roles", () => {
		for (const role of ALL_ROLES) {
			expect(
				ROLE_FALLBACK_ORDER[role],
				`Expected fallback chain for role: ${role}`,
			).toBeDefined();
		}
	});

	test("every role has at least 3 providers in its fallback chain", () => {
		for (const role of ALL_ROLES) {
			expect(
				ROLE_FALLBACK_ORDER[role].length,
				`Role '${role}' fallback chain should have >= 3 providers`,
			).toBeGreaterThanOrEqual(3);
		}
	});

	test("fallback chains only reference valid providers present in the capability manifest", () => {
		for (const role of ALL_ROLES) {
			for (const id of ROLE_FALLBACK_ORDER[role]) {
				const cap = getProviderCapability(id);
				expect(
					cap,
					`Fallback chain for role '${role}' references unknown provider: ${id}`,
				).toBeDefined();
			}
		}
	});
});
