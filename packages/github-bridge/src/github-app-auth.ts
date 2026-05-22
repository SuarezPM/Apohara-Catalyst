/**
 * GitHub App auth per spec §9.1.
 *
 * Reads env:
 *   APOHARA_GITHUB_APP_ID
 *   APOHARA_GITHUB_APP_PRIVATE_KEY_PATH
 *
 * Generates a JWT for app auth, exchanges for installation token,
 * caches with TTL 50min (refresh proactively at 50min; expires at 60min).
 */
import { readFile } from "node:fs/promises";
import { createAppAuth } from "@octokit/auth-app";

export interface GitHubAppAuthOpts {
  appId?: string;        // override env
  privateKeyPath?: string; // override env
  installationId?: number; // optional; if omitted, picks first installation
  privateKey?: string;   // override file read (test injection)
}

export interface InstallationTokenCache {
  token: string;
  expiresAt: number;  // unix ms
}

const TTL_MS = 50 * 60 * 1000; // refresh proactively at 50 min

export class GitHubAppAuth {
  private cache: InstallationTokenCache | null = null;
  private appId: string;
  private privateKeyPromise: Promise<string>;
  private installationId?: number;

  constructor(opts: GitHubAppAuthOpts = {}) {
    this.appId = opts.appId ?? process.env.APOHARA_GITHUB_APP_ID ?? "";
    if (!this.appId) throw new Error("APOHARA_GITHUB_APP_ID env (or appId opt) required");

    if (opts.privateKey) {
      this.privateKeyPromise = Promise.resolve(opts.privateKey);
    } else {
      const path = opts.privateKeyPath ?? process.env.APOHARA_GITHUB_APP_PRIVATE_KEY_PATH;
      if (!path) throw new Error("APOHARA_GITHUB_APP_PRIVATE_KEY_PATH env (or privateKeyPath/privateKey opt) required");
      this.privateKeyPromise = readFile(path, "utf-8");
    }

    this.installationId = opts.installationId;
  }

  async getInstallationToken(): Promise<string> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.token;
    }
    const privateKey = await this.privateKeyPromise;
    const auth = createAppAuth({
      appId: this.appId,
      privateKey,
      installationId: this.installationId,
    });
    const result = await auth({ type: "installation" }) as { token: string; expiresAt: string };
    const expiresAt = new Date(result.expiresAt).getTime() - 10 * 60 * 1000; // refresh 10min before expiry
    this.cache = { token: result.token, expiresAt: Math.min(expiresAt, now + TTL_MS) };
    return this.cache.token;
  }

  clearCache(): void {
    this.cache = null;
  }
}