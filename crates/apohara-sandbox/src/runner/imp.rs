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

use nix::fcntl::OFlag;
use nix::sys::wait::{waitpid, WaitStatus};
use nix::unistd::{
    chdir, dup2_stderr, dup2_stdin, dup2_stdout, execvp, fork, pipe2, read,
    write, ForkResult,
};
use std::ffi::CString;
use std::os::fd::{AsFd, OwnedFd};
use std::time::Instant;

use crate::error::{Result, SandboxError};
use crate::namespace::enter_isolated_namespaces;
use crate::runner::{SandboxRequest, SandboxResult};

pub fn run_linux(req: SandboxRequest) -> Result<SandboxResult> {
    let started = Instant::now();

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

            let stdout = read_to_string(&stdout_r)?;
            let stderr = read_to_string(&stderr_r)?;

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

    // Final hop. If execvp returns, it failed — write the errno to the
    // exec-error pipe and exit. The parent reads the errno to surface a
    // clean violation rather than guessing from the exit code.
    let err = match execvp(&argv[0], argv) {
        Ok(_inf) => unreachable!("execvp returned Ok"),
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

fn read_to_string(fd: &OwnedFd) -> Result<String> {
    let mut out = Vec::new();
    let mut buf = [0u8; 4096];
    loop {
        match read(fd.as_fd(), &mut buf) {
            Ok(0) => break,
            Ok(n) => out.extend_from_slice(&buf[..n]),
            Err(nix::errno::Errno::EINTR) => continue,
            Err(e) => return Err(io_err(e)),
        }
    }
    Ok(String::from_utf8_lossy(&out).into_owned())
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
