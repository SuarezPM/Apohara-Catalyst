/**
 * PR builder with idempotency key per spec §9.5.
 *
 * Builds PR body with Apohara template (header + Run ID + agents +
 * verification + replay link + changes + INV-15 status). Embeds
 * `<!-- apohara-attempt: sha256:HEX -->` HTML comment for idempotency.
 *
 * Lookup strategy (in order):
 *   1. findPRByIdempotencyKey(repo, key) — match the HTML comment
 *   2. findPRByHeadBranch(repo, head)    — match by head branch name
 *   3. findLinkedPRs(repo, issueNum)     — regex match close/fix #N
 */
import { createHash } from "node:crypto";
import type { OctokitClient } from "./octokit-client.js";

export interface PRBuildInput {
  owner: string;
  repo: string;
  issueNumber?: number;
  runId: string;
  headBranch: string;
  baseBranch: string;
  title: string;
  changesSummary: string;
  agents: { id: string; role: string }[];
  verificationVerdict: { judge?: number; critic?: number; invariantsOk: boolean };
  replayUrl?: string;
  attemptKey: string;  // logical key — sha'd into idempotency marker
}

export interface ExistingPR {
  number: number;
  state: "open" | "closed";
  merged: boolean;
  body: string;
  head: string;
}

export interface PRRepo {
  /** List PRs in repo (open or closed) — used for all 3 lookup strategies. */
  listPRs(repo: { owner: string; repo: string }, params?: { state?: "open" | "closed" | "all"; head?: string }): Promise<ExistingPR[]>;
  /** Create a new PR. */
  createPR(repo: { owner: string; repo: string }, params: { title: string; body: string; head: string; base: string }): Promise<{ number: number; html_url: string }>;
  /** Update an existing PR body. */
  updatePR(repo: { owner: string; repo: string }, prNumber: number, params: { body: string }): Promise<void>;
}

export class GitHubPRRepo implements PRRepo {
  constructor(private client: OctokitClient) {}

  async listPRs(repo: { owner: string; repo: string }, params: { state?: "open" | "closed" | "all"; head?: string } = {}): Promise<ExistingPR[]> {
    const result = await this.client.request(async () => {
      return this.client.octokit.pulls.list({
        owner: repo.owner,
        repo: repo.repo,
        state: params.state ?? "all",
        ...(params.head ? { head: `${repo.owner}:${params.head}` } : {}),
        per_page: 100,
      });
    });
    return result.data.map(p => ({
      number: p.number,
      state: p.state as "open" | "closed",
      merged: p.merged_at !== null,
      body: p.body ?? "",
      head: p.head.ref,
    }));
  }

  async createPR(repo: { owner: string; repo: string }, params: { title: string; body: string; head: string; base: string }): Promise<{ number: number; html_url: string }> {
    const r = await this.client.request(async () => {
      return this.client.octokit.pulls.create({
        owner: repo.owner,
        repo: repo.repo,
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base,
      });
    });
    return { number: r.data.number, html_url: r.data.html_url };
  }

  async updatePR(repo: { owner: string; repo: string }, prNumber: number, params: { body: string }): Promise<void> {
    await this.client.request(async () => {
      return this.client.octokit.pulls.update({
        owner: repo.owner,
        repo: repo.repo,
        pull_number: prNumber,
        body: params.body,
      });
    });
  }
}

export function computeIdempotencyKey(attemptKey: string): string {
  return createHash("sha256").update(attemptKey).digest("hex");
}

export function buildPRBody(input: PRBuildInput): string {
  const key = computeIdempotencyKey(input.attemptKey);
  const inv = input.verificationVerdict.invariantsOk ? "OK" : "FAILED";
  const judge = input.verificationVerdict.judge !== undefined ? input.verificationVerdict.judge.toFixed(2) : "-";
  const critic = input.verificationVerdict.critic !== undefined ? input.verificationVerdict.critic.toFixed(2) : "-";
  const agents = input.agents.map(a => `- \`${a.id}\` (${a.role})`).join("\n");
  const replay = input.replayUrl ? `\n\n**Replay:** ${input.replayUrl}\n` : "";
  const issueRef = input.issueNumber ? `\n\nCloses #${input.issueNumber}\n` : "";

  return `<!-- apohara-attempt: sha256:${key} -->

## Apohara Run

**Run ID:** \`${input.runId}\`

### Agents
${agents}

### Verification
- Judge: ${judge}
- Critic: ${critic}
- INV-15 (Apohara invariants): ${inv}
${replay}
### Changes
${input.changesSummary}
${issueRef}`;
}

export async function findPRByIdempotencyKey(repo: PRRepo, owner: string, repoName: string, attemptKey: string): Promise<ExistingPR | null> {
  const key = computeIdempotencyKey(attemptKey);
  const marker = `<!-- apohara-attempt: sha256:${key} -->`;
  const prs = await repo.listPRs({ owner, repo: repoName }, { state: "all" });
  return prs.find(p => p.body.includes(marker)) ?? null;
}

export async function findPRByHeadBranch(repo: PRRepo, owner: string, repoName: string, headBranch: string): Promise<ExistingPR | null> {
  const prs = await repo.listPRs({ owner, repo: repoName }, { head: headBranch, state: "all" });
  return prs.find(p => p.head === headBranch) ?? null;
}

export async function findLinkedPRs(repo: PRRepo, owner: string, repoName: string, issueNumber: number): Promise<ExistingPR[]> {
  const pattern = new RegExp(`\\b(close[sd]?|fix(?:e[sd])?)\\s+#${issueNumber}\\b`, "i");
  const prs = await repo.listPRs({ owner, repo: repoName }, { state: "all" });
  return prs.filter(p => pattern.test(p.body));
}

export interface CreateOrUpdateResult {
  action: "created" | "updated" | "noop_merged";
  prNumber: number;
  htmlUrl?: string;
}

export async function createOrUpdatePR(repo: PRRepo, input: PRBuildInput): Promise<CreateOrUpdateResult> {
  // Strategy 1: idempotency key
  let existing = await findPRByIdempotencyKey(repo, input.owner, input.repo, input.attemptKey);
  // Strategy 2: head branch
  if (!existing) existing = await findPRByHeadBranch(repo, input.owner, input.repo, input.headBranch);
  // Strategy 3: linked PRs (only if issueNumber known)
  if (!existing && input.issueNumber !== undefined) {
    const linked = await findLinkedPRs(repo, input.owner, input.repo, input.issueNumber);
    existing = linked.find(p => p.state === "open") ?? linked[0] ?? null;
  }

  const body = buildPRBody(input);

  if (existing) {
    if (existing.merged) {
      return { action: "noop_merged", prNumber: existing.number };
    }
    if (existing.state === "open") {
      await repo.updatePR({ owner: input.owner, repo: input.repo }, existing.number, { body });
      return { action: "updated", prNumber: existing.number };
    }
  }

  const created = await repo.createPR({ owner: input.owner, repo: input.repo }, {
    title: input.title, body, head: input.headBranch, base: input.baseBranch,
  });
  return { action: "created", prNumber: created.number, htmlUrl: created.html_url };
}
