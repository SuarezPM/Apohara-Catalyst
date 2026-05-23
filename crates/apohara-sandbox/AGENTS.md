# apohara-sandbox — Agent Guide

seccomp-bpf + Linux namespaces sandbox for running untrusted subprocess
output (formatter scripts, custom hooks, anything the agent generated and
wants to execute locally). On macOS the equivalent is a `sandbox-exec` profile;
on Windows the sandbox is a no-op shim that the orchestrator detects and falls
back to non-sandboxed (with a warning).

## When to use

- Running formatter / linter binaries the agent claims are "safe"
- Executing user-generated test commands from an agent's plan
- Any subprocess that the orchestrator's permission grid would otherwise
  prompt the user for *and* the user opted into "auto-sandbox the rest"

## Pattern

```rust
use apohara_sandbox::{SandboxRunner, SandboxPolicy};

let runner = SandboxRunner::new(SandboxPolicy::readonly_workspace("/path/to/wt"))?;
let output = runner.run(&["cargo", "fmt", "--check"]).await?;
```

## Critical

- **Env sanitization** is mandatory — every spawn routes through
  `build_sanitized_env()`. NEVER pass `process.env` raw (see CLAUDE.md
  "wrong account billed" incident).
- **No network by default** — the policy must opt in explicitly.
- **Workdir is read-only** by default — writes need `SandboxPolicy::readwrite`.
- Tests use `APOHARA_MOCK_SANDBOX=1` on platforms without seccomp.

## What this crate is NOT

- Not the permission grid — that decides whether to sandbox; this crate
  enforces the box once chosen.
- Not a full container runtime — no images, no user namespace remapping.
