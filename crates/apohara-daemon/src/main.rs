//! Daemon binary entry-point. Boots tokio runtime, loads the profile, prints
//! the version + profile path, and parks until SIGTERM (graceful shutdown).
//!
//! Sprint 6 (G6.A.1) — skeleton only. Wave 2 follow-ups wire the local socket
//! listener (G6.A.3) and the WS hub (G6.A.5).

use apohara_daemon::{daemon_mode_enabled, version};
use apohara_daemon::profiles::Profile;
use apohara_daemon::shutdown::ShutdownController;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let args: Vec<String> = std::env::args().collect();
    let mut profile_name: Option<String> = None;
    let mut iter = args.iter().skip(1);
    while let Some(arg) = iter.next() {
        if let Some(stripped) = arg.strip_prefix("--profile=") {
            profile_name = Some(stripped.to_string());
        } else if arg == "--profile" {
            profile_name = iter.next().cloned();
        } else if arg == "--version" {
            println!("apohara-daemon {}", version());
            return Ok(());
        }
    }

    let profile = if let Some(name) = profile_name {
        Profile::load_from_user_dir(&name)?
    } else {
        Profile::default_profile()
    };

    tracing::info!(
        version = version(),
        profile = profile.name.as_str(),
        socket = ?profile.socket_path(),
        daemon_mode = daemon_mode_enabled(),
        "apohara-daemon starting"
    );

    if !daemon_mode_enabled() {
        tracing::warn!(
            "APOHARA_DAEMON_MODE=1 not set — daemon binary started anyway (explicit invocation). \
             Backward-compat shim still routes clients to monolithic mode unless flag is on."
        );
    }

    let shutdown = ShutdownController::new();
    shutdown.spawn_signal_listener();
    shutdown.wait().await;

    tracing::info!("apohara-daemon shutdown complete");
    Ok(())
}
