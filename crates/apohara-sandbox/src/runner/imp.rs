//! Linux-specific runner implementation (M014.4).
//!
//! Topology:
//!
//! ```text
//!  parent (orchestrator)
//!    │  pipes for stdout / stderr / exec-error
//!    │  fork() ──────────────────────────────────┐
//!    │                                            │
//!    │  read pipes + waitpid(middle)              ▼
//!    │                                          middle child
//!    │                                            │  enter_isolated_namespaces()
//!    │                                            │  fork() ─────────────────┐
//!    │                                            │                          │
//!    │                                            │  waitpid(grand)          ▼
//!    │                                            │  _exit(grand status)    grandchild
//!    │                                            │                          │
//!    │                                            │                          │  dup2 pipes
//!    │                                            │                          │  chdir(workdir)
//!    │                                            │                          │  install seccomp
//!    │                                            │                          │  execvp(command)
//! ```
//!
//! Why two forks: `unshare(CLONE_NEWPID)` only takes effect for *future*
//! children of the caller. The middle child has to fork once more so the
//! grandchild is PID 1 in the new PID namespace.
//!
//! The exec-error pipe lets the grandchild surface a failure inside
//! `execvp(2)` to the parent: the grandchild writes the errno (4 bytes)
//! to a FD_CLOEXEC pipe just before calling execvp. If execvp succeeds,
//! the FD_CLOEXEC flag closes the pipe and the parent reads EOF. If it
//! fails, the parent reads 4 bytes and reports a clean "execve_failed"
//! violation.

use apohara_pathsafety::{canonicalize_recursive, PathSafetyError, MAX_SYMLINK_HOPS};
use nix::fcntl::OFlag;
use nix::sys::wait::{waitpid, WaitStatus};
use nix::unistd::{
    chdir, dup2_stderr, dup2_stdin, dup2_stdout, execvpe, fork, pipe2, read,
    write, ForkResult,
};
use std::ffi::CString;
use std::os::fd::{AsFd, OwnedFd};
use std::thread;
use std::time::Instant;

use crate::error::{Result, SandboxError};
use crate::namespace::enter_isolated_namespaces;
use crate::runner::{SandboxRequest, SandboxResult};

/// G7.5.A.10 — validate `workdir` against `workspace_root` BEFORE spawn,
/// using `apohara_pathsafety::canonicalize_recursive` so we can surface
/// `DanglingSymlink` / `SymlinkLoop` / `EscapesRoot` as distinct errors
/// instead of an opaque `io::Error`. `std::fs::canonicalize` collapses
/// the three into one — losing the signal that distinguishes "broken
/// config" (dangling) from "attack attempt" (escape).
///
/// Callers that don't supply a `workspace_root` skip validation: the
/// seccomp + namespace bundle is still in effect, so this stays
/// backward-compatible for legacy payloads.
pub fn validate_workdir(req: &SandboxRequest) -> Result<()> {
    let Some(root) = &req.workspace_root else {
        return Ok(());
    };
    let root_canon = canonicalize_recursive(root, MAX_SYMLINK_HOPS).map_err(|e| {
        map_pathsafety(e, "workspace_root", root)
    })?;
    let workdir_canon =
        canonicalize_recursive(&req.workdir, MAX_SYMLINK_HOPS).map_err(|e| {
            map_pathsafety(e, "workdir", &req.workdir)
        })?;
    if !workdir_canon.starts_with(&root_canon) {
        return Err(SandboxError::NamespaceError(format!(
            "workdir EscapesRoot: workdir={} canonical={} root={}",
            req.workdir.display(),
            workdir_canon.display(),
            root_canon.display(),
        )));
    }
    Ok(())
}

/// Map the rich pathsafety error variants into the sandbox's flat
/// `NamespaceError` channel while preserving the variant name in the
/// message so callers can grep / dispatch on it.
fn map_pathsafety(
    e: PathSafetyError,
    label: &str,
    path: &std::path::Path,
) -> SandboxError {
    let kind = match &e {
        PathSafetyError::DanglingSymlink { .. } => "DanglingSymlink",
        PathSafetyError::SymlinkLoop { .. } => "SymlinkLoop",
        PathSafetyError::EscapesRoot { .. } => "EscapesRoot",
        PathSafetyError::SymlinkEscape { .. } => "SymlinkEscape",
        PathSafetyError::ParentTraversal(_) => "ParentTraversal",
        PathSafetyError::EqualToRoot => "EqualToRoot",
        PathSafetyError::InvalidCharsInIdentifier(_) => "InvalidCharsInIdentifier",
        PathSafetyError::Io(_) => "Io",
    };
    SandboxError::NamespaceError(format!(
        "{label} {kind}({}): {e}",
        path.display()
    ))
}

/// Hard cap on the bytes we'll buffer from the grandchild's stdout/stderr.
/// A runaway or hostile child can otherwise write gigabytes and OOM the
/// orchestrator before the parent decides to terminate it.
const MAX_OUTPUT_BYTES: usize = 16 * 1024 * 1024;

/// Env vars that survive the §0.4 sanitization pass and are passed
/// through to the sandboxed child. Keep this list as small as possible —
/// every variable here is something the child can READ. The list deliberately
/// excludes every credential / token / API-key shape.
const ENV_ALLOW_NAMES: &[&str] = &[
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TERM", "LANG", "TMPDIR",
    "PWD", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR",
];

/// Patterns (substring match, uppercased name) that ALWAYS strip the
/// variable. Mirrors the TypeScript `src/core/persistence/envSanitizer.ts`
/// blocklist: `*_API_KEY`, `*_TOKEN`, `*_SECRET`, AWS_*, ANTHROPIC_*, etc.
fn is_secret_env_name(name: &str) -> bool {
    let up = name.to_ascii_uppercase();
    const SUFFIXES: &[&str] = &[
        "_API_KEY", "_KEY", "_TOKEN", "_SECRET", "_PASSWORD", "_PASSWD",
    ];
    const PREFIXES: &[&str] = &[
        "ANTHROPIC_", "OPENAI_", "GROQ_", "TOGETHER_", "MISTRAL_",
        "OPENROUTER_", "GEMINI_", "GOOGLE_", "COHERE_", "XAI_", "DEEPSEEK_",
        "PERPLEXITY_", "FIREWORKS_", "PINECONE_", "VOYAGE_", "REPLICATE_",
        "HUGGINGFACE_", "AWS_", "GCP_", "GCLOUD_", "AZURE_", "CLOUDFLARE_",
        "DIGITALOCEAN_", "VERCEL_", "NETLIFY_", "HEROKU_", "RENDER_",
        "SUPABASE_", "STRIPE_", "SENTRY_", "CIRCLE_", "GITLAB_", "BITBUCKET_",
    ];
    if PREFIXES.iter().any(|p| up.starts_with(p)) {
        return true;
    }
    if SUFFIXES.iter().any(|s| up.ends_with(s)) {
        return true;
    }
    matches!(
        up.as_str(),
        "HF_TOKEN"
            | "GITHUB_TOKEN"
            | "GH_TOKEN"
            | "FLY_API_TOKEN"
            | "RAILWAY_TOKEN"
            | "NPM_TOKEN"
            | "DATABASE_URL"
            | "MONGODB_URI"
            | "MYSQL_URL"
            | "POSTGRES_URL"
            | "REDIS_URL"
            | "NOTION_TOKEN"
            | "SLACK_TOKEN"
            | "SLACK_BOT_TOKEN"
            | "DISCORD_TOKEN"
            | "TELEGRAM_TOKEN"
            | "LINEAR_API_KEY"
    )
}

/// Build the env we'll hand to the grandchild. Only the explicit
/// allowlist + non-secret-looking variables survive. Returns the env as
/// a `Vec<CString>` ready to feed to `execve(2)`.
fn build_sanitized_env() -> Vec<CString> {
    let mut env: Vec<CString> = Vec::new();
    for (key, value) in std::env::vars_os() {
        let Some(key_str) = key.to_str() else { continue };
        let Some(value_str) = value.to_str() else { continue };
        let is_allowed = ENV_ALLOW_NAMES.iter().any(|n| *n == key_str);
        if !is_allowed && is_secret_env_name(key_str) {
            continue;
        }
        // Drop env names containing `=` or NUL — they can't be encoded
        // in the KEY=VALUE wire format anyway.
        if key_str.contains('=') || key_str.contains('\0') {
            continue;
        }
        let combined = format!("{key_str}={value_str}");
        if let Ok(c) = CString::new(combined) {
            env.push(c);
        }
    }
    env
}

pub fn run_linux(req: SandboxRequest) -> Result<SandboxResult> {
    let started = Instant::now();

    // §3.1 + G7.5.A.10 — refuse early when `workdir` escapes the user's
    // declared workspace_root. Uses `canonicalize_recursive` to detect
    // DanglingSymlink, SymlinkLoop, and EscapesRoot as distinct error
    // variants. Callers that don't pass a `workspace_root` (older code)
    // skip this validation — defence in depth via the seccomp +
    // namespace bundle still applies.
    validate_workdir(&req)?;

    // Pipes for the grandchild's stdout, stderr, and exec-error channel.
    // Each pair is (read_end, write_end). CLOEXEC on the exec-error pipe
    // so a successful execvp closes it automatically.
    let (stdout_r, stdout_w) = make_pipe(false)?;
    let (stderr_r, stderr_w) = make_pipe(false)?;
    let (exec_err_r, exec_err_w) = make_pipe(true)?;

    // Resolve the command name once so the child doesn't have to allocate
    // CStrings after fork.
    if req.command.is_empty() {
        return Err(SandboxError::NamespaceError(
            "command must have at least one argv".into(),
        ));
    }
    let argv: Vec<CString> = req
        .command
        .iter()
        .map(|a| CString::new(a.as_str()).expect("argv must not contain NUL"))
        .collect();

    match unsafe { fork() }.map_err(io_err)? {
        ForkResult::Parent { child: middle } => {
            // Close the child-side FDs so reads return EOF when the
            // grandchild exits.
            drop(stdout_w);
            drop(stderr_w);
            drop(exec_err_w);

            // Drain both pipes concurrently so a grandchild that fills
            // the stderr pipe (~64 KiB) while we're still blocked reading
            // stdout can't deadlock the parent. Each pipe gets its own
            // thread that reads up to MAX_OUTPUT_BYTES before truncating.
            let stdout_handle =
                thread::spawn(move || read_bounded(&stdout_r, MAX_OUTPUT_BYTES));
            let stderr_handle =
                thread::spawn(move || read_bounded(&stderr_r, MAX_OUTPUT_BYTES));
            let stdout = stdout_handle
                .join()
                .map_err(|_| SandboxError::NamespaceError("stdout drain panic".into()))??;
            let stderr = stderr_handle
                .join()
                .map_err(|_| SandboxError::NamespaceError("stderr drain panic".into()))??;

            // Drain the exec-error pipe. Empty = exec succeeded; 4 bytes
            // = errno from a failed execvp.
            let exec_err = read_exact_errno(&exec_err_r)?;

            let middle_status = waitpid(middle, None).map_err(io_err)?;
            let (exit_code, violations) =
                summarize_status(middle_status, exec_err, &req);

            Ok(SandboxResult {
                exit_code,
                stdout,
                stderr,
                duration_ms: started.elapsed().as_millis() as u64,
                violations,
            })
        }
        ForkResult::Child => {
            // Middle child. Drop parent-side pipe ends.
            drop(stdout_r);
            drop(stderr_r);
            drop(exec_err_r);

            // Enter the M014.3 namespace bundle. The user/mount ns moves
            // the middle child into the new namespaces immediately; the
            // PID ns applies to the *next* fork below.
            if let Err(e) = enter_isolated_namespaces() {
                report_setup_error(&exec_err_w, format!("namespace: {e}"));
                unsafe { libc::_exit(70) };
            }

            match unsafe { fork() } {
                Err(e) => {
                    report_setup_error(&exec_err_w, format!("inner fork: {e}"));
                    unsafe { libc::_exit(71) };
                }
                Ok(ForkResult::Parent { child: grand }) => {
                    // Middle child holds nothing else; close pipes so the
                    // grandchild owns the only write ends.
                    drop(stdout_w);
                    drop(stderr_w);
                    drop(exec_err_w);

                    match waitpid(grand, None) {
                        Ok(WaitStatus::Exited(_, c)) => unsafe { libc::_exit(c) },
                        Ok(WaitStatus::Signaled(_, sig, _)) => unsafe {
                            libc::_exit(128 + sig as i32)
                        },
                        _ => unsafe { libc::_exit(72) },
                    }
                }
                Ok(ForkResult::Child) => {
                    // Grandchild: PID 1 in the new PID namespace.
                    run_grandchild(&req, &argv, stdout_w, stderr_w, exec_err_w);
                }
            }
        }
    }
}

/// Inside the grandchild: redirect stdio, chdir, apply seccomp, execvp.
/// Any failure is written to the exec-error pipe (which is CLOEXEC, so a
/// successful exec closes it) before _exit'ing.
fn run_grandchild(
    req: &SandboxRequest,
    argv: &[CString],
    stdout_w: OwnedFd,
    stderr_w: OwnedFd,
    exec_err_w: OwnedFd,
) -> ! {
    // Redirect stdin to /dev/null so a wait-for-input child doesn't hang
    // when the parent collects output. Best-effort.
    if let Ok(devnull) = std::fs::File::open("/dev/null") {
        let _ = dup2_stdin(devnull.as_fd());
    }

    // Redirect stdout and stderr onto the parent-owned pipes.
    if dup2_stdout(stdout_w.as_fd()).is_err() {
        report_setup_error(&exec_err_w, "dup2 stdout".into());
        unsafe { libc::_exit(80) };
    }
    if dup2_stderr(stderr_w.as_fd()).is_err() {
        report_setup_error(&exec_err_w, "dup2 stderr".into());
        unsafe { libc::_exit(81) };
    }
    drop(stdout_w);
    drop(stderr_w);

    if let Err(e) = chdir(req.workdir.as_path()) {
        report_setup_error(&exec_err_w, format!("chdir({:?}): {e}", req.workdir));
        unsafe { libc::_exit(82) };
    }

    let prof = crate::profile::for_tier(req.permission);
    if let Err(e) = prof.install() {
        report_setup_error(&exec_err_w, format!("seccomp install: {e}"));
        unsafe { libc::_exit(83) };
    }

    // §0.4 — pass a sanitized env to the grandchild. The orchestrator's
    // own env (API keys, OAuth tokens, runner credentials) would
    // otherwise be inherited straight into an untrusted agent. The
    // sanitizer keeps PATH/HOME/USER/LANG/etc and strips every secret-
    // looking name (mirrors src/core/persistence/envSanitizer.ts).
    let env = build_sanitized_env();

    // Final hop. If execvpe returns, it failed — write the errno to
    // the exec-error pipe and exit. The parent reads the errno to
    // surface a clean violation rather than guessing from the exit
    // code.
    let err = match execvpe(&argv[0], argv, &env) {
        Ok(_inf) => unreachable!("execvpe returned Ok"),
        Err(e) => e,
    };
    let raw = err as i32;
    let bytes = raw.to_le_bytes();
    let _ = write(exec_err_w.as_fd(), &bytes);
    unsafe { libc::_exit(126) };
}

/// Best-effort error report into the exec-error pipe followed by an exit.
/// We can't propagate a Rust string cleanly back to the parent, so the
/// parent encodes any non-zero read as "setup failure" and surfaces the
/// child's exit code.
fn report_setup_error(pipe_w: &OwnedFd, msg: String) {
    let bytes = msg.into_bytes();
    let trimmed = &bytes[..bytes.len().min(256)];
    let _ = write(pipe_w.as_fd(), trimmed);
}

fn make_pipe(cloexec: bool) -> Result<(OwnedFd, OwnedFd)> {
    // pipe2(O_CLOEXEC) is atomic; pipe2(empty) leaves both fds without
    // close-on-exec. The grandchild needs the stdout/stderr write ends
    // *without* CLOEXEC so they survive execvp; the exec-error pipe
    // needs CLOEXEC so a successful execvp closes it automatically.
    let flags = if cloexec { OFlag::O_CLOEXEC } else { OFlag::empty() };
    let (r, w) = pipe2(flags).map_err(io_err)?;
    Ok((r, w))
}

/// Read from `fd` until EOF, capping the buffer at `max_bytes`. Anything
/// beyond the cap is silently discarded — a runaway child can no longer
/// OOM the orchestrator by spewing gigabytes into the pipe. Returns the
/// captured prefix as UTF-8 (lossy on invalid sequences, matching the
/// previous behavior).
fn read_bounded(fd: &OwnedFd, max_bytes: usize) -> Result<String> {
    let mut out = Vec::new();
    let mut buf = [0u8; 4096];
    let mut overflow = false;
    loop {
        match read(fd.as_fd(), &mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if out.len() + n <= max_bytes {
                    out.extend_from_slice(&buf[..n]);
                } else if out.len() < max_bytes {
                    let take = max_bytes - out.len();
                    out.extend_from_slice(&buf[..take]);
                    overflow = true;
                } else {
                    overflow = true;
                }
            }
            Err(nix::errno::Errno::EINTR) => continue,
            Err(e) => return Err(io_err(e)),
        }
    }
    let mut s = String::from_utf8_lossy(&out).into_owned();
    if overflow {
        s.push_str("\n... [output truncated]\n");
    }
    Ok(s)
}

/// Drain the exec-error pipe. Returns `Some(errno)` if the grandchild
/// wrote exactly 4 bytes (failed execvp), `None` if the pipe is empty
/// (successful exec), or `Some(-1)` for any unexpected read shape.
fn read_exact_errno(fd: &OwnedFd) -> Result<Option<i32>> {
    let mut buf = [0u8; 4];
    let mut filled = 0;
    while filled < buf.len() {
        match read(fd.as_fd(), &mut buf[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(nix::errno::Errno::EINTR) => continue,
            Err(e) => return Err(io_err(e)),
        }
    }
    if filled == 0 {
        Ok(None)
    } else if filled == 4 {
        Ok(Some(i32::from_le_bytes(buf)))
    } else {
        Ok(Some(-1))
    }
}

fn summarize_status(
    status: WaitStatus,
    exec_err: Option<i32>,
    req: &SandboxRequest,
) -> (i32, Vec<String>) {
    let mut violations: Vec<String> = Vec::new();
    let cmd = req.command.first().map(String::as_str).unwrap_or("?");

    if let Some(errno) = exec_err {
        violations.push(format!("execve_failed(errno={errno}, command={cmd:?})"));
    }

    let exit_code = match status {
        WaitStatus::Exited(_, c) => c,
        WaitStatus::Signaled(_, sig, _) => {
            violations.push(format!("killed_by_signal({sig:?})"));
            128 + sig as i32
        }
        other => {
            violations.push(format!("unexpected_wait_status({other:?})"));
            -1
        }
    };

    // ReadOnly grandchildren can't even write the exec-error errno back
    // (the `write` syscall isn't in their allowlist), so when execve
    // fails *and* write fails, we see exit_code=126 with no exec_err
    // bytes. Synthesize the violation from the exit code so callers
    // still see something useful.
    if exit_code == 126 && exec_err.is_none() {
        violations.push(format!(
            "execve_failed(errno=unknown, command={cmd:?}) — write also blocked by tier"
        ));
    }

    (exit_code, violations)
}

fn io_err<E: std::fmt::Display>(e: E) -> SandboxError {
    SandboxError::NamespaceError(format!("runner: {e}"))
}

/// Tests that exercise the full fork+seccomp+exec chain. Marked
/// `#[ignore]` by default because they require the kernel to allow
/// unprivileged user namespaces (`kernel.unprivileged_userns_clone=1`).
/// Run with: `cargo test -p apohara-sandbox --test runner_integration`.
#[cfg(test)]
mod tests {}
