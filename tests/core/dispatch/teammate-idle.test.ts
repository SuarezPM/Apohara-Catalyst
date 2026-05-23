/**
 * claude-octopus hallazgo 7 — TeammateIdle dispatch (G5.B.10).
 *
 * Apohara's ExecutorAction chain is push-based — the chain is
 * pre-constructed before the run starts and walked sequentially.
 * claude-octopus's `teammate-idle-dispatch.sh` is pull-based: when
 * an agent finishes its sub-task and goes IDLE, the dispatcher
 * notices and can route a pending task its way (multi-agent
 * delegation).
 *
 * The TeammateIdle state is the runtime signal that drives this:
 *
 *   newTeammateRoster() → roster
 *   markBusy(roster, agentId, taskId) → roster'
 *   markIdle(roster, agentId, finishedTaskId?) → roster'
 *   pickIdleAgent(roster) → agentId | null
 *   pickIdleAgentForCapability(roster, "coder") → agentId | null
 *   isIdle(roster, agentId) → bool
 *
 * Pure value module — coordinator owns the timing (when to ping
 * `pickIdleAgent`); the state transitions are agent-supplied via
 * markBusy / markIdle.
 */
import { expect, test } from "bun:test";
import {
	isIdle,
	markBusy,
	markIdle,
	newTeammateRoster,
	pickIdleAgent,
	pickIdleAgentForCapability,
	registerAgent,
} from "../../../src/core/dispatch/teammate-idle";

test("newTeammateRoster is empty; no idle agents to pick", () => {
	const r = newTeammateRoster();
	expect(pickIdleAgent(r)).toBeNull();
});

test("registerAgent adds an agent in idle state by default", () => {
	let r = newTeammateRoster();
	r = registerAgent(r, { id: "claude-1", capabilities: ["coder"] });
	expect(isIdle(r, "claude-1")).toBe(true);
	expect(pickIdleAgent(r)).toBe("claude-1");
});

test("markBusy flips an idle agent to non-idle", () => {
	let r = newTeammateRoster();
	r = registerAgent(r, { id: "claude-1", capabilities: ["coder"] });
	r = markBusy(r, "claude-1", "t-100");
	expect(isIdle(r, "claude-1")).toBe(false);
	expect(pickIdleAgent(r)).toBeNull();
});

test("markIdle flips a busy agent back to idle", () => {
	let r = newTeammateRoster();
	r = registerAgent(r, { id: "claude-1", capabilities: ["coder"] });
	r = markBusy(r, "claude-1", "t-100");
	r = markIdle(r, "claude-1", "t-100");
	expect(isIdle(r, "claude-1")).toBe(true);
});

test("pickIdleAgent returns lexicographically-first idle agent for stability", () => {
	let r = newTeammateRoster();
	r = registerAgent(r, { id: "claude-2", capabilities: [] });
	r = registerAgent(r, { id: "claude-1", capabilities: [] });
	expect(pickIdleAgent(r)).toBe("claude-1");
});

test("pickIdleAgentForCapability filters by capability set", () => {
	let r = newTeammateRoster();
	r = registerAgent(r, { id: "claude-coder", capabilities: ["coder"] });
	r = registerAgent(r, { id: "claude-judge", capabilities: ["judge"] });
	expect(pickIdleAgentForCapability(r, "coder")).toBe("claude-coder");
	expect(pickIdleAgentForCapability(r, "judge")).toBe("claude-judge");
	expect(pickIdleAgentForCapability(r, "critic")).toBeNull();
});

test("busy agent is invisible to both pickers", () => {
	let r = newTeammateRoster();
	r = registerAgent(r, { id: "a", capabilities: ["coder"] });
	r = markBusy(r, "a", "t-x");
	expect(pickIdleAgent(r)).toBeNull();
	expect(pickIdleAgentForCapability(r, "coder")).toBeNull();
});

test("markBusy on already-busy agent retains current task id (no overwrite)", () => {
	let r = newTeammateRoster();
	r = registerAgent(r, { id: "a", capabilities: [] });
	r = markBusy(r, "a", "t-1");
	// Attempting to re-mark with a different task id should be a
	// no-op or explicit-fail; here we keep current.
	r = markBusy(r, "a", "t-2");
	expect(r.agents["a"]?.currentTaskId).toBe("t-1");
});

test("markIdle on unknown agent is a no-op (defensive)", () => {
	let r = newTeammateRoster();
	r = markIdle(r, "ghost-agent", "t-x");
	expect(isIdle(r, "ghost-agent")).toBe(false); // unknown agents stay unknown
});

test("registerAgent on an already-known agent does NOT reset busy state", () => {
	let r = newTeammateRoster();
	r = registerAgent(r, { id: "a", capabilities: [] });
	r = markBusy(r, "a", "t-1");
	r = registerAgent(r, { id: "a", capabilities: ["coder"] });
	// existing busy state preserved; capabilities updated
	expect(isIdle(r, "a")).toBe(false);
	expect(r.agents["a"]?.capabilities).toEqual(["coder"]);
});
