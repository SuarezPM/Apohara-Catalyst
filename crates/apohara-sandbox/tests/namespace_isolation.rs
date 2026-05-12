//! Integration tests for the Linux namespace isolation (M014.3).
//!
//! The verify gate: a process inside the sandboxed PID namespace cannot
//! see host PIDs.
//!
//! Because `unshare(CLONE_NEWPID)` only reparents *future* children of the
//! caller, the test fork()s twice:
//!   - Child A: applies `enter_isolated_namespaces()`, then fork()s child B.
//!   - Child B: reads `/proc/self/status` and asserts its own Tgid == 1.
//!     Also confirms host PIDs that exist in the parent (the test runner's
//!     PID) are NOT visible under `/proc/<host_pid>` in B's view.
//!
//! Both children call `_exit` so Rust's drop chain (which can issue
//! syscalls we'd rather not depend on inside the new namespaces) is
//! skipped.

#![cfg(target_os = "linux")]

use apohara_sandbox::namespace::enter_isolated_namespaces;
use nix::sys::wait::{waitpid, WaitStatus};
use nix::unistd::{fork, getpid, ForkResult, Pid};
use std::fs::read_to_string;

#[test]
fn child_in_new_pid_namespace_has_tgid_1() {
    // Skip cleanly if the kernel doesn't allow unprivileged user-ns
    // creation (some hardened distros set kernel.unprivileged_userns_clone=0).
    if std::fs::read_to_string("/proc/sys/kernel/unprivileged_userns_clone")
        .ok()
        .and_then(|s| s.trim().parse::<i32>().ok())
        == Some(0)
    {
        eprintln!("SKIP: kernel.unprivileged_userns_clone is disabled");
        return;
    }

    let host_pid_of_test_runner = std::process::id() as i32;

    let outer = unsafe { fork() }.expect("outer fork");
    match outer {
        ForkResult::Parent { child: a } => {
            let status = waitpid(a, None).expect("waitpid A");
            let code = match status {
                WaitStatus::Exited(_, c) => c,
                WaitStatus::Signaled(_, sig, _) => panic!(
                    "child A killed by signal {sig:?} — check kernel namespace support"
                ),
                other => panic!("unexpected status from child A: {other:?}"),
            };
            assert_eq!(
                code, 0,
                "child A reported failure (code {code}). \
                 See test stderr for the in-child trace."
            );
        }
        ForkResult::Child => {
            // Inside child A: enter the isolated namespaces, then fork
            // child B which is the one that sees PID 1.
            if let Err(e) = enter_isolated_namespaces() {
                eprintln!("child A: enter_isolated_namespaces failed: {e}");
                unsafe { libc::_exit(80) };
            }

            let inner = unsafe { fork() }.expect("inner fork");
            match inner {
                ForkResult::Parent { child: b } => {
                    let status = waitpid(b, None).expect("waitpid B");
                    let code = match status {
                        WaitStatus::Exited(_, c) => c,
                        WaitStatus::Signaled(_, sig, _) => {
                            eprintln!("child B killed by {sig:?}");
                            128 + sig as i32
                        }
                        _ => 91,
                    };
                    unsafe { libc::_exit(code) };
                }
                ForkResult::Child => {
                    // Child B — should be PID 1 in the new PID ns. We use
                    // the getpid(2) syscall directly: it reports the PID
                    // in the *calling* PID namespace. Reading /proc/self
                    // would instead pull from the host /proc (because we
                    // haven't remounted /proc in this mount namespace
                    // yet — M014.3.x will add that) and would report the
                    // host-visible PID.
                    let inner_pid = getpid().as_raw();
                    if inner_pid != 1 {
                        eprintln!(
                            "child B: getpid() returned {inner_pid}, expected 1 \
                             — PID namespace did not take effect"
                        );
                        unsafe { libc::_exit(71) };
                    }

                    // Negative check: the test runner's host PID exists
                    // outside the new PID ns. From inside, `kill(host_pid,
                    // 0)` (signal-0 = existence probe) must fail with
                    // ESRCH. We can't use /proc/<host_pid> here because
                    // the still-host-mounted /proc lies; the syscall path
                    // honors the namespace.
                    let probe = unsafe {
                        libc::kill(host_pid_of_test_runner, 0)
                    };
                    if probe == 0 {
                        eprintln!(
                            "child B: kill(host_pid={host_pid_of_test_runner}, 0) \
                             succeeded — PID namespace did not hide the host"
                        );
                        unsafe { libc::_exit(72) };
                    }
                    let err = std::io::Error::last_os_error().raw_os_error();
                    if err != Some(libc::ESRCH) {
                        eprintln!(
                            "child B: kill probe returned errno {err:?}, \
                             expected ESRCH"
                        );
                        unsafe { libc::_exit(73) };
                    }

                    unsafe { libc::_exit(0) };
                }
            }
        }
    }
}

#[test]
fn enter_isolated_namespaces_does_not_affect_parent() {
    // Confirms the test process itself is not perturbed by other tests
    // that fork + unshare. We check that we can still see ourselves under
    // /proc, which is the cheapest "host PID ns is intact" probe.
    let my_pid = Pid::this().as_raw();
    let status_path = format!("/proc/{my_pid}/status");
    let status = read_to_string(&status_path).expect("read own /proc status");
    assert!(
        status.contains(&format!("Pid:\t{my_pid}")),
        "test runner's /proc/<pid>/status must list its own PID — \
         got status[..120]={:?}",
        &status[..status.len().min(120)]
    );
}
