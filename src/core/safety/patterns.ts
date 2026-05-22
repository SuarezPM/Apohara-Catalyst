/**
 * Permission pattern matcher per spec §4.6.
 *
 * Supports the same grammar as the official Claude CLI:
 *   Bash(npm test:*)         → bash_prefix
 *   WebFetch(domain:X)       → webfetch_domain
 *   Edit(glob)               → edit_glob
 *   mcp__server__*           → mcp_prefix
 *
 * Glob uses minimatch-style wildcards via Bun.glob.
 */
import { Glob } from "bun";
import { posix } from "node:path";

export type PermissionPattern =
  | { kind: "bash_prefix"; prefix: string }
  | { kind: "webfetch_domain"; domain: string }
  | { kind: "edit_glob"; glob: string }
  | { kind: "mcp_prefix"; prefix: string };

export interface ToolInvocation {
  tool: string;
  input: Record<string, unknown>;
}

export function matchPattern(p: PermissionPattern, inv: ToolInvocation): boolean {
  switch (p.kind) {
    case "bash_prefix":
      return inv.tool === "Bash" && typeof inv.input.command === "string" && inv.input.command.startsWith(p.prefix);
    case "webfetch_domain": {
      if (inv.tool !== "WebFetch") return false;
      const url = inv.input.url;
      if (typeof url !== "string") return false;
      try {
        const u = new URL(url);
        return u.hostname === p.domain || u.hostname.endsWith("." + p.domain);
      } catch { return false; }
    }
    case "edit_glob": {
      const file = inv.input.file_path;
      if (typeof file !== "string") return false;
      // Normalize before matching: fold `..` / `.` segments so a pattern
      // like `Edit(subdir/**)` cannot match `subdir/../../etc/passwd`
      // by literal-prefix accident. We keep the path relative when the
      // input was relative (so an existing `Edit(src/**)` pattern still
      // matches `src/api/users.ts`), and only normalize the `..`
      // segments. Cross-platform slashes are folded to POSIX form.
      const normalized = posix.normalize(file.replace(/\\/g, "/"));
      return new Glob(p.glob).match(normalized);
    }
    case "mcp_prefix":
      return inv.tool.startsWith(p.prefix);
  }
}

export function parsePatternString(s: string): PermissionPattern | null {
  // Bash(npm test:*) → { kind: "bash_prefix", prefix: "npm test" }
  const bash = s.match(/^Bash\((.+?):\*\)$/);
  if (bash) return { kind: "bash_prefix", prefix: bash[1] };

  // WebFetch(domain:github.com) → { kind: "webfetch_domain", domain: "github.com" }
  const wf = s.match(/^WebFetch\(domain:(.+)\)$/);
  if (wf) return { kind: "webfetch_domain", domain: wf[1] };

  // Edit(glob) → { kind: "edit_glob", glob }
  const edit = s.match(/^Edit\((.+)\)$/);
  if (edit) return { kind: "edit_glob", glob: edit[1] };

  // mcp__server__* → { kind: "mcp_prefix", prefix: "mcp__server__" }
  if (s.startsWith("mcp__") && s.endsWith("*")) {
    return { kind: "mcp_prefix", prefix: s.slice(0, -1) };  // strip trailing *
  }
  return null;
}
