# M014.2 — Seccomp profile research (FULL recovery 2026-05-12)

**Source:** MiniMax 2.7, 35.4s research, 2026-05-12 (second dispatch with tmux
history-limit raised to 50000). The first dispatch lost the per-tier syscall
list to pane scroll; this second pass recovered the full data.

---

## Tier 1: ReadOnly Syscalls (~45 total)

Pure-allow (no conditions):
```
read, pread64, readv, preadv2
close, dup, dup2, dup3, lseek
mmap, munmap, mremap, brk, mprotect, madvise
getpid, getppid, gettid, getuid, getgid, geteuid, getegid
rt_sigprocmask, rt_sigaction, rt_sigreturn, sigaltstack
clock_gettime, clock_gettime64, gettimeofday, nanosleep, clock_nanosleep
getrandom
prctl, arch_prctl
exit, exit_group
newfstatat, statx, fstat, lstat
faccessat, faccessat2
readlinkat
fstatfs, statfs
```

Conditional:
- `openat` — only with flags ⊆ `O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_DIRECTORY | O_PATH | O_NONBLOCK`. Block O_WRONLY, O_RDWR, O_CREAT, O_TRUNC, O_APPEND.

## Tier 2: WorkspaceWrite Syscalls (Tier 1 + ~32 more)

Pure-allow additions:
```
write, pwrite64, writev, pwritev2
creat, mkdirat, unlinkat, renameat2, linkat, symlinkat
ftruncate, truncate
fchmodat, chmod
utimensat, futimens
pipe2
fchdir, chdir
getdents64, getdents
copy_file_range, sendfile
fchown, fchownat, lchown
fallocate
fsync, fdatasync, sync_file_range
```

Conditional additions:
- `openat` — all flags allowed (replaces Tier 1's restricted variant)
- `fcntl` — only `F_GETFL`, `F_SETFL`, `F_DUPFD`, `F_DUPFD_CLOEXEC`. Block F_SETOWN, F_GETOWN_EX (signal-driven IO escape), F_NOTIFY.
- `ioctl` — only `TIOCGWINSZ`, `FIOCLEX`, `FIONCLEX`. Block FIBMAP (block-device introspection), TUNSET* (TUN/TAP device creation), SIOCSIFADDR.

## Tier 3: DangerFullAccess

No seccomp filter. The orchestrator must enforce explicit user consent via a
`--i-know-what-im-doing` flag before any task uses this tier.

---

## Risks (each tier has a residual escape vector)

### Tier 1 — Information disclosure via `/proc/self/mem`

`lseek` on `/proc/self/mem` (fd ≥ 3) lets a process write to its own address
space. If the LLM agent can reconstruct a writable mem fd via
`/proc/self/fd/`, it can inject code into its own process. Seccomp filters
don't prevent fd-reconstruction attacks from `/proc` entries because
`openat` with `O_RDONLY` on `/proc/self/mem` is a valid Tier-1 open.

**Mitigations** (M014.3 namespace work):
- Drop `CAP_SYS_PTRACE`
- Mount `/proc` with `hidepid=2`
- Block `openat` on any `/proc/self/*` path (path-level check in M014.3, not
  achievable in seccomp alone)

### Tier 2 — Symlink race escapes workdir via `openat` + `O_CREAT`

An agent can create a symlink inside workdir pointing to `/etc/passwd`, then
open that symlink with `O_CREAT | O_TRUNC` via `openat`. The filter sees an
`openat` on a path inside workdir (allowed), but the symlink target resolves
outside workdir. Result: workdir confinement bypassed.

**Mitigations**:
- Resolve all paths before the prefix check (the kernel does this, but the
  seccomp filter does not)
- Deny `O_CREAT | O_TRUNC` on any fd whose resolved path is outside workdir
  (M014.3 mount-namespace work — pivot_root to workdir so all paths are
  relative)
- Require `O_NOFOLLOW` as a hard precondition on all `openat` calls when
  followed by write-class flags

### Tier 3 — User-consent gate is the only line of defense

DangerFullAccess agents have full host access. The escape vector is the
orchestrator forgetting to require the `--i-know-what-im-doing` flag, or a
prompt-injection attack that tricks the orchestrator into spawning at this
tier. Mitigations live in TS-layer policy gating, not in this crate.

---

## Common mistakes to avoid (from research)

1. **Allowing `execve` / `execveat` in any tier** — even with a binary
   allowlist, the allowlist itself can be escaped if the LLM can write to a
   whitelisted path's contents (drop in a malicious binary at the
   allowlisted name).
2. **Forgetting `clock_gettime64` / `clock_settime64`** — `clock_gettime`
   is the 32-bit compat call; `clock_gettime64` is the 64-bit native call.
   Both must be allowed on x86_64 if 32-bit binaries can be invoked via
   compat mode.
3. **Allowing `ptrace`** — even `PTRACE_TRACEME` is dangerous because
   `ptrace(PTRACE_PEEKTEXT, ...)` reads process memory. Block unconditionally.
4. **Allowing `eventfd`** — combined with fork, useful for covert
   signaling. Block unconditionally.
5. **Conditional flag checks with `&` instead of exact comparison** —
   `O_RDONLY` equals 0, so mask-and-compare is broken for it. Use
   `SeccompCompare::Eq` for flag equality.

---

## Implementation plan (M014.2)

1. **Data structures** (this milestone):
   - `pub const READONLY_PURE_ALLOW: &[&str] = &[…]`
   - `pub const READONLY_CONDITIONAL: &[(&str, &str)] = &[("openat", "rdonly-flags")]`
   - `pub const WORKSPACE_WRITE_PURE_ALLOW: &[&str] = &[…]`
   - `pub const WORKSPACE_WRITE_CONDITIONAL: &[(&str, &str)] = &[…]`

2. **Filter builder** (this milestone):
   - `fn build_filter(tier: PermissionTier) -> Result<SeccompFilter>`
   - Compiles to BPF; doesn't install (install happens in the child after fork).

3. **Unit tests** (this milestone):
   - Lists are non-empty
   - Workspace ⊇ Readonly (every Readonly syscall is also in Workspace)
   - Build filter for each tier without panic

4. **Real install in child** (M014.3, depends on namespace setup):
   - `seccompiler::apply_filter(bpf_program)?` after `unshare(2)` in child
   - Default action: `SeccompAction::KillProcess` (fail-closed)
