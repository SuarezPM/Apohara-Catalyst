/**
 * culture #1 — event bus con tags estructurados (namespace.subtag.*)
 * y subscribe-by-pattern. Reemplaza el bus EventTarget plano si lo
 * usa el codebase, o coexiste como capa nueva.
 */

export interface TaggedEvent<T = unknown> {
	tag: string;
	payload: T;
	ts?: number;
}

type Handler<T = unknown> = (e: TaggedEvent<T>) => void;

export class TaggedEventBus {
	private subs: Array<{ pattern: string; handler: Handler }> = [];

	subscribe(opts: { tag: string }, handler: Handler): () => void {
		const entry = { pattern: opts.tag, handler };
		this.subs.push(entry);
		return () => {
			this.subs = this.subs.filter((s) => s !== entry);
		};
	}

	publish(event: TaggedEvent): void {
		const e = { ...event, ts: event.ts ?? Date.now() };
		for (const s of this.subs) {
			if (this.matches(s.pattern, e.tag)) s.handler(e);
		}
	}

	private matches(pattern: string, tag: string): boolean {
		if (pattern === tag) return true;
		if (pattern.endsWith(".*")) {
			const prefix = `${pattern.slice(0, -2)}.`;
			return tag.startsWith(prefix);
		}
		return false;
	}
}
