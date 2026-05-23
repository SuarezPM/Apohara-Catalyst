/**
 * culture #6 — universal verbs `explain | overview | learn` that
 * dispatch to a registered entity's structured handler. UI/CLI can
 * use the same entry point without per-entity boilerplate.
 */

export type Verb = "explain" | "overview" | "learn";

export interface DispatchArgs {
	verb: Verb;
	target: string;
	registry: Record<string, Record<string, unknown>>;
}

export async function dispatchUniversalVerb(args: DispatchArgs): Promise<string> {
	if (!["explain", "overview", "learn"].includes(args.verb)) {
		throw new Error(`unknown verb: ${args.verb}`);
	}
	const entity = args.registry[args.target];
	if (!entity) return `Target not found: ${args.target}`;

	switch (args.verb) {
		case "explain":
			return Object.entries(entity)
				.map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
				.join("\n");
		case "overview": {
			const taskCount = entity.taskCount ?? 0;
			const doneCount = entity.doneCount ?? 0;
			return `Overview of ${args.target}: ${taskCount} tasks (${doneCount} done).`;
		}
		case "learn":
			return `Learning resources for ${args.target}: see docs/.`;
	}
}
