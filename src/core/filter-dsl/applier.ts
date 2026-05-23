import type { FilterAST } from "./parser.ts";

export function applyFilter(ast: FilterAST, obj: Record<string, unknown>): boolean {
	switch (ast.op) {
		case "eq":
			return obj[ast.field] === ast.value;
		case "neq":
			return obj[ast.field] !== ast.value;
		case "lt":
			return (obj[ast.field] as number) < ast.value;
		case "lte":
			return (obj[ast.field] as number) <= ast.value;
		case "gt":
			return (obj[ast.field] as number) > ast.value;
		case "gte":
			return (obj[ast.field] as number) >= ast.value;
		case "and":
			return applyFilter(ast.left, obj) && applyFilter(ast.right, obj);
		case "or":
			return applyFilter(ast.left, obj) || applyFilter(ast.right, obj);
		case "not":
			return !applyFilter(ast.inner, obj);
		default:
			return false;
	}
}
