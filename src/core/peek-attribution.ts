/**
 * culture #14 (PARCIAL → COMPLETO) — peek attribution audit trail.
 *
 * When an agent "peeks" at a file or piece of state (read-only inspection),
 * record (who, what, when) so we can prove provenance later. Useful for:
 *  - reproducing why an agent made a decision (which files did it read?),
 *  - cost accounting (read-heavy agents) y
 *  - security audits (catch unexpected reads of sensitive paths).
 */

export interface PeekRecord {
	agent: string;
	target: string;
	at: number;
}

export interface RecordArgs {
	agent: string;
	target: string;
	at?: number;
}

export class PeekAttributionLog {
	private entries: PeekRecord[] = [];

	record(args: RecordArgs): void {
		this.entries.push({
			agent: args.agent,
			target: args.target,
			at: args.at ?? Date.now(),
		});
	}

	list(): PeekRecord[] {
		return [...this.entries];
	}

	byAgent(agent: string): PeekRecord[] {
		return this.entries.filter((r) => r.agent === agent);
	}

	byTarget(target: string): PeekRecord[] {
		return this.entries.filter((r) => r.target === target);
	}

	clear(): void {
		this.entries = [];
	}
}
