/**
 * GitHub Issues poller per spec §9.4.
 *
 * Polls octokit.list_issues({label: 'apohara', state: 'open'}) every 60s.
 * For each unprocessed issue (cross-check messages with from='@github'
 * and payload.issue_id):
 *   - parseIssue(body)
 *   - if ambiguous → post comment "needs clarification: ..." + add
 *     apohara-needs-input label
 *   - else → insertTask(db, {...}) + add apohara-in-progress label
 *
 * Test seam: IssueSource interface lets tests inject a stub Octokit.
 */
import type { OrchestrationDb } from "../../../src/core/orchestration/db.js";
import { insertTask, type TaskInput } from "../../../src/core/orchestration/tasks.js";
import { sendMessage } from "../../../src/core/orchestration/messages.js";
import { parseIssue, type ObjectivePayload } from "./issue-parser.js";

export interface IssueSummary {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export interface IssueSource {
  listOpenLabeled(label: string): Promise<IssueSummary[]>;
  postComment(issueNumber: number, body: string): Promise<void>;
  addLabel(issueNumber: number, label: string): Promise<void>;
}

export interface PollerOpts {
  db: OrchestrationDb;
  source: IssueSource;
  repoLabel?: string;  // default "apohara"
}

export interface PollResult {
  newTasks: number;
  ambiguous: number;
  alreadyProcessed: number;
}

export async function pollOnce(opts: PollerOpts): Promise<PollResult> {
  const label = opts.repoLabel ?? "apohara";
  const issues = await opts.source.listOpenLabeled(label);
  const result: PollResult = { newTasks: 0, ambiguous: 0, alreadyProcessed: 0 };

  for (const issue of issues) {
    const existing = opts.db.raw().query(
      "SELECT id FROM messages WHERE from_handle = ? AND thread_id = ? LIMIT 1"
    ).get("@github", `issue-${issue.number}`);
    if (existing) {
      result.alreadyProcessed += 1;
      continue;
    }

    const parsed = parseIssue(issue.body);
    if (parsed.kind === "ambiguous") {
      await opts.source.postComment(
        issue.number,
        `Apohara: this issue is ambiguous — needs clarification: ${parsed.missing.join(", ")}\n\nReply with more detail and remove the \`apohara-needs-input\` label to retry.`,
      );
      await opts.source.addLabel(issue.number, "apohara-needs-input");
      result.ambiguous += 1;
      continue;
    }

    const taskId = `gh-${issue.number}-${Date.now()}`;
    const input: TaskInput = {
      id: taskId,
      spec: {
        description: parsed.payload.objective,
        agentRole: "coder",
        symbols: { reads: [], writes: [], renames: [] },
      },
      deps: [],
      createdByTerminalHandle: "@github",
    };
    insertTask(opts.db, input);

    sendMessage(opts.db, {
      fromHandle: "@github",
      toHandle: "@coordinator",
      type: "dispatch",
      threadId: `issue-${issue.number}`,
      payload: {
        issue_id: issue.number,
        task_id: taskId,
        acceptance_criteria: parsed.payload.acceptanceCriteria,
        priority: parsed.payload.priority,
      },
    });

    await opts.source.addLabel(issue.number, "apohara-in-progress");
    result.newTasks += 1;
  }

  return result;
}