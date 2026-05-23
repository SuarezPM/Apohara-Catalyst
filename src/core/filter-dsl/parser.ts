/**
 * culture #2 — safe predicate DSL for event-driven rules / capability
 * targeting. Subset of expression grammar: literals (string/number/bool),
 * field access (a.b.c), comparisons (==, !=, <, <=, >, >=), boolean
 * operators (&&, ||, !), parentheses. NO arbitrary code execution.
 */

export type FilterAST =
	| { op: "literal"; value: string | number | boolean | null }
	| { op: "field"; path: string[] }
	| { op: "eq"; field: string; value: string | number | boolean }
	| { op: "neq"; field: string; value: string | number | boolean }
	| { op: "lt" | "lte" | "gt" | "gte"; field: string; value: number }
	| { op: "and"; left: FilterAST; right: FilterAST }
	| { op: "or"; left: FilterAST; right: FilterAST }
	| { op: "not"; inner: FilterAST };

// Minimal recursive-descent parser.
class Parser {
	constructor(
		private src: string,
		public pos = 0,
	) {}
	private skip(): void {
		while (this.pos < this.src.length && /\s/.test(this.src[this.pos] ?? "")) this.pos++;
	}
	private match(s: string): boolean {
		this.skip();
		if (this.src.startsWith(s, this.pos)) {
			this.pos += s.length;
			return true;
		}
		return false;
	}

	parseOr(): FilterAST {
		let left = this.parseAnd();
		while (this.match("||")) {
			const right = this.parseAnd();
			left = { op: "or", left, right };
		}
		return left;
	}
	parseAnd(): FilterAST {
		let left = this.parseNot();
		while (this.match("&&")) {
			const right = this.parseNot();
			left = { op: "and", left, right };
		}
		return left;
	}
	parseNot(): FilterAST {
		if (this.match("!")) return { op: "not", inner: this.parsePrimary() };
		return this.parsePrimary();
	}
	parsePrimary(): FilterAST {
		this.skip();
		if (this.match("(")) {
			const inner = this.parseOr();
			if (!this.match(")")) throw new Error("parse: expected )");
			return inner;
		}
		// Identifier (field)
		const idMatch = this.src.slice(this.pos).match(/^[A-Za-z_][A-Za-z0-9_.]*/);
		if (!idMatch) throw new Error(`parse: unexpected at ${this.pos}`);
		const field = idMatch[0];
		this.pos += field.length;
		this.skip();
		// Comparator
		const ops: Array<[string, FilterAST["op"]]> = [
			["==", "eq"],
			["!=", "neq"],
			["<=", "lte"],
			[">=", "gte"],
			["<", "lt"],
			[">", "gt"],
		];
		for (const [tok, op] of ops) {
			if (this.match(tok)) {
				const value = this.parseLiteral();
				return { op, field, value } as FilterAST;
			}
		}
		throw new Error(`parse: expected comparator after ${field}`);
	}
	parseLiteral(): string | number | boolean {
		this.skip();
		if (this.match('"')) {
			const start = this.pos;
			while (this.pos < this.src.length && this.src[this.pos] !== '"') this.pos++;
			const str = this.src.slice(start, this.pos);
			if (!this.match('"')) throw new Error("parse: unterminated string");
			return str;
		}
		const numMatch = this.src.slice(this.pos).match(/^-?\d+(\.\d+)?/);
		if (numMatch) {
			this.pos += numMatch[0].length;
			return parseFloat(numMatch[0]);
		}
		if (this.match("true")) return true;
		if (this.match("false")) return false;
		throw new Error(`parse: expected literal at ${this.pos}`);
	}
}

export function parseFilter(src: string): FilterAST {
	const p = new Parser(src);
	return p.parseOr();
}
