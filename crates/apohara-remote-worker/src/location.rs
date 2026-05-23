//! Where to run a task — local, an SSH-attached host, a Docker image (placeholder),
//! or a Kubernetes pod (placeholder).
//!
//! v1.0 (this commit, G6.C.4) implements `Local` and `Ssh`. `Docker` and
//! `Kubernetes` are reserved for future sprints; constructors exist but no
//! dispatch path uses them.

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LocationError {
    #[error("ssh user must be non-empty")]
    SshUserEmpty,
    #[error("ssh host must be non-empty")]
    SshHostEmpty,
    #[error("ssh port must be in 1..=65535, got {0}")]
    SshPortInvalid(u32),
    #[error("docker image must be non-empty")]
    DockerImageEmpty,
    #[error("kubernetes pod must be non-empty")]
    KubernetesPodEmpty,
}

/// Tagged enum so the JSON envelope on the wire is self-describing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WorkerLocation {
    Local,
    Ssh {
        host: String,
        port: u16,
        user: String,
    },
    /// Reserved for future sprints. No dispatch path yet.
    #[allow(dead_code)]
    Docker { image: String },
    /// Reserved for future sprints. No dispatch path yet.
    #[allow(dead_code)]
    Kubernetes { pod: String },
}

impl Default for WorkerLocation {
    fn default() -> Self {
        Self::Local
    }
}

impl WorkerLocation {
    pub fn local() -> Self {
        Self::Local
    }

    pub fn ssh(host: impl Into<String>, port: u16, user: impl Into<String>) -> Result<Self, LocationError> {
        let host = host.into();
        let user = user.into();
        if host.is_empty() {
            return Err(LocationError::SshHostEmpty);
        }
        if user.is_empty() {
            return Err(LocationError::SshUserEmpty);
        }
        if port == 0 {
            return Err(LocationError::SshPortInvalid(0));
        }
        Ok(Self::Ssh { host, port, user })
    }

    pub fn docker(image: impl Into<String>) -> Result<Self, LocationError> {
        let image = image.into();
        if image.is_empty() {
            return Err(LocationError::DockerImageEmpty);
        }
        Ok(Self::Docker { image })
    }

    pub fn kubernetes(pod: impl Into<String>) -> Result<Self, LocationError> {
        let pod = pod.into();
        if pod.is_empty() {
            return Err(LocationError::KubernetesPodEmpty);
        }
        Ok(Self::Kubernetes { pod })
    }

    pub fn is_local(&self) -> bool {
        matches!(self, Self::Local)
    }

    pub fn is_remote(&self) -> bool {
        !self.is_local()
    }

    /// True when a dispatch path exists in v1.0. Docker/Kubernetes return false.
    pub fn is_dispatchable_v1(&self) -> bool {
        matches!(self, Self::Local | Self::Ssh { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_local() {
        assert_eq!(WorkerLocation::default(), WorkerLocation::Local);
    }

    #[test]
    fn ssh_constructor_validates() {
        assert!(WorkerLocation::ssh("", 22, "u").is_err());
        assert!(WorkerLocation::ssh("h", 22, "").is_err());
        assert!(WorkerLocation::ssh("h", 0, "u").is_err());
        let ok = WorkerLocation::ssh("h", 22, "u").unwrap();
        assert!(matches!(ok, WorkerLocation::Ssh { .. }));
    }

    #[test]
    fn docker_constructor_validates() {
        assert!(WorkerLocation::docker("").is_err());
        assert!(WorkerLocation::docker("apohara/worker:1").is_ok());
    }

    #[test]
    fn kubernetes_constructor_validates() {
        assert!(WorkerLocation::kubernetes("").is_err());
        assert!(WorkerLocation::kubernetes("worker-pod").is_ok());
    }

    #[test]
    fn is_remote_and_dispatchable() {
        assert!(!WorkerLocation::Local.is_remote());
        assert!(WorkerLocation::Local.is_dispatchable_v1());

        let ssh = WorkerLocation::ssh("h", 22, "u").unwrap();
        assert!(ssh.is_remote());
        assert!(ssh.is_dispatchable_v1());

        let dk = WorkerLocation::docker("img:1").unwrap();
        assert!(dk.is_remote());
        assert!(!dk.is_dispatchable_v1(), "docker dispatch is not in v1.0");
    }

    #[test]
    fn serde_round_trip_local() {
        let s = serde_json::to_string(&WorkerLocation::Local).unwrap();
        assert_eq!(s, r#"{"kind":"local"}"#);
        let back: WorkerLocation = serde_json::from_str(&s).unwrap();
        assert_eq!(back, WorkerLocation::Local);
    }

    #[test]
    fn serde_round_trip_ssh() {
        let s = serde_json::to_string(
            &WorkerLocation::Ssh { host: "127.0.0.1".into(), port: 22, user: "ci".into() }
        ).unwrap();
        assert!(s.contains(r#""kind":"ssh""#));
        assert!(s.contains(r#""host":"127.0.0.1""#));
        let back: WorkerLocation = serde_json::from_str(&s).unwrap();
        assert!(matches!(back, WorkerLocation::Ssh { .. }));
    }

    #[test]
    fn serde_round_trip_docker_and_kubernetes() {
        let dk = WorkerLocation::docker("apohara:1").unwrap();
        let kb = WorkerLocation::kubernetes("p1").unwrap();
        let dk_s = serde_json::to_string(&dk).unwrap();
        let kb_s = serde_json::to_string(&kb).unwrap();
        assert_eq!(
            serde_json::from_str::<WorkerLocation>(&dk_s).unwrap(),
            dk
        );
        assert_eq!(
            serde_json::from_str::<WorkerLocation>(&kb_s).unwrap(),
            kb
        );
    }
}
