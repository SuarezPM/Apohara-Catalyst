/**
 * Octokit wrapper with exponential backoff (5xx) + rate-limit awareness.
 * Reads x-ratelimit-remaining header; sleeps until x-ratelimit-reset when 0.
 */
import { Octokit } from "@octokit/rest";

export interface OctokitClientOpts {
  auth?: string;  // Bearer token; for tests, can be left undefined
  userAgent?: string;
  maxRetries?: number;
}

export class OctokitClient {
  readonly octokit: Octokit;
  private maxRetries: number;

  constructor(opts: OctokitClientOpts = {}) {
    this.octokit = new Octokit({
      auth: opts.auth,
      userAgent: opts.userAgent ?? "apohara-github-bridge/1.0",
    });
    this.maxRetries = opts.maxRetries ?? 3;
  }

  /**
   * Execute with retries on 5xx + rate-limit aware sleep.
   * @returns the request response. Throws after maxRetries 5xx.
   */
  async request<T>(op: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await op();
      } catch (e) {
        const err = e as { status?: number; response?: { headers?: Record<string, string> } };
        const status = err.status ?? 0;
        const headers = err.response?.headers ?? {};

        if (status === 429 || (status === 403 && headers["x-ratelimit-remaining"] === "0")) {
          const reset = parseInt(headers["x-ratelimit-reset"] ?? "0", 10);
          const sleepMs = Math.max(1000, reset * 1000 - Date.now());
          await sleep(Math.min(sleepMs, 60_000));  // cap at 60s
          continue;  // retry doesn't count toward maxRetries
        }
        if (status >= 500 && status < 600 && attempt < this.maxRetries) {
          await sleep(2 ** attempt * 1000);  // 1s, 2s, 4s
          attempt += 1;
          continue;
        }
        throw e;
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
