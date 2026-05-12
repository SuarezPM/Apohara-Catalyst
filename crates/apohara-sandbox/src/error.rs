use thiserror::Error;

#[derive(Debug, Error)]
pub enum SandboxError {
    #[error("syscall {syscall} blocked by seccomp profile {profile}")]
    SyscallBlocked { syscall: String, profile: String },

    #[error("sandbox not available on this platform")]
    Unavailable,

    #[error("namespace setup failed: {0}")]
    NamespaceError(String),

    #[error("seccomp filter installation failed: {0}")]
    SeccompError(String),

    #[error("invalid permission tier: {0}")]
    InvalidPermission(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("child process exited with status {0}")]
    ChildExit(i32),
}

pub type Result<T> = std::result::Result<T, SandboxError>;
