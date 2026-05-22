import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOrchestrationDb, type OrchestrationDb } from "../../../src/core/orchestration/db";
import { insertTask } from "../../../src/core/orchestration/tasks";
import { insertDispatchContext } from "../../../src/core/orchestration/dispatch-contexts";
import { sendMessage } from "../../../src/core/orchestration/messages";
import { resolveGroup } from "../../../src/core/orchestration/groups";

let workDir: string;
let db: OrchestrationDb;

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), "apohara-grp-"));
	db = await openOrchestrationDb(join(workDir, "o.db"));
	insertTask(db, {
		id: "t1",
		spec: { description: "x", agentRole: "coder", symbols: { reads: [], writes: [], renames: [] } },
		deps: [],
	});
	insertTask(db, {
		id: "t2",
		spec: { description: "y", agentRole: "coder", symbols: { reads: [], writes: [], renames: [] } },
		deps: [],
	});
	insertDispatchContext(db, {
		taskId: "t1",
		agentHandle: "agent:claude:t1",
		worktreeId: "wt-A",
		preamble: "p1",
	});
	insertDispatchContext(db, {
		taskId: "t2",
		agentHandle: "agent:codex:t2",
		worktreeId: "wt-A",
		preamble: "p2",
	});
	// Both inserted as "spawning"; flip to running for the @all/@worktree tests
	db.raw().exec(`UPDATE dispatch_contexts SET status = 'running'`);
});

afterEach(async () => {
	db.close();
	await rm(workDir, { recursive: true, force: true });
});

test("resolves @claude to claude agent handles only", () => {
	const handles = resolveGroup(db, "@claude");
	expect(handles).toEqual(["agent:claude:t1"]);
});

test("resolves @codex to codex agent handles only", () => {
	const handles = resolveGroup(db, "@codex");
	expect(handles).toEqual(["agent:codex:t2"]);
});

test("resolves @worktree:wt-A to all agents in that worktree", () => {
	const handles = resolveGroup(db, "@worktree:wt-A");
	expect(handles.sort()).toEqual(["agent:claude:t1", "agent:codex:t2"]);
});

test("resolves @worktree:wt-missing to empty list", () => {
	const handles = resolveGroup(db, "@worktree:wt-missing");
	expect(handles).toEqual([]);
});

test("resolves @all to all running agents", () => {
	const handles = resolveGroup(db, "@all");
	expect(handles.length).toBe(2);
	expect(handles.sort()).toEqual(["agent:claude:t1", "agent:codex:t2"]);
});

test("@all excludes terminal-status dispatches", () => {
	db.raw().exec(`UPDATE dispatch_contexts SET status = 'completed' WHERE agent_handle = 'agent:codex:t2'`);
	const handles = resolveGroup(db, "@all");
	expect(handles).toEqual(["agent:claude:t1"]);
});

test("@idle excludes agents with unread dispatch messages", () => {
	sendMessage(db, {
		fromHandle: "agent:coordinator:root",
		toHandle: "agent:claude:t1",
		type: "dispatch",
		payload: { foo: "bar" },
	});
	const handles = resolveGroup(db, "@idle");
	expect(handles).toEqual(["agent:codex:t2"]);
});

test("@idle ignores non-dispatch/escalation message types", () => {
	sendMessage(db, {
		fromHandle: "agent:coordinator:root",
		toHandle: "agent:claude:t1",
		type: "heartbeat",
		payload: null,
	});
	const handles = resolveGroup(db, "@idle");
	expect(handles.sort()).toEqual(["agent:claude:t1", "agent:codex:t2"]);
});

test("non-group handle passes through unchanged", () => {
	expect(resolveGroup(db, "agent:claude:t99")).toEqual(["agent:claude:t99"]);
});
