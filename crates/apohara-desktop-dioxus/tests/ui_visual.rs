//! In-process VISUAL snapshot harness for the Apohara Dioxus desktop shell.
//!
//! This is NOT a headless compositor. It launches the *real* `App` in a hidden
//! window (`WindowBuilder::with_visible(false)`), drives the global UI signals
//! through a sequence of *isolated* states, and for each state:
//!   1. asserts DOM structure / computed CSS via `document::eval` (JS),
//!   2. grabs a REAL pixel PNG of the WebKitGTK surface via
//!      `WebViewExt::snapshot_future(Visible)` -> `cairo::Surface`.
//!
//! Pattern source (Dioxus 0.7.9 canonical headless_tests):
//!   - utils.rs : deadman switch + `LaunchBuilder::desktop().with_window(visible(false))`
//!   - eval.rs  : `document::eval`, `use_future`, `window().close()` to exit
//!
//! Snapshot path: `use_window()` -> `DesktopContext` (`Rc<DesktopService>`) whose
//! public `webview: wry::WebView` -> `wry::WebViewExtUnix::webview()` ->
//! `webkit2gtk::WebView` -> `snapshot_future(...)` -> `cairo::Surface` ->
//! `Surface::write_to_png`.
//!
//! Threading: WebKitGTK / cairo calls MUST run on the GTK main thread. The
//! dioxus-desktop tao+gtk event loop lives on the main thread; we hop the
//! snapshot onto glib's default `MainContext` with `spawn_local` and await the
//! result back in the dioxus future through a oneshot channel.
//!
//! VIEWPORT (fix #1): the window is locked to a logical 1280x800, BUT a hidden
//! tao window never assigns the WebKit `GtkWidget` a physical size — its
//! viewport stays 0x0, so the central `1fr` grid track collapses (~130px) and
//! text wraps oddly. `force_viewport_size` pins the webview widget (and its
//! toplevel) to 1280x800 and pumps the GTK loop, so WebKit re-lays-out at the
//! real viewport width. We then snapshot `SnapshotRegion::FullDocument` (the
//! `Visible` region can't be captured from an unrealized hidden window). With
//! the viewport forced wide, FullDocument reflects the production layout and
//! the `1fr` track resolves to ~600px.
//!
//! ISOLATION (fix #2): every global signal is reset to its default before each
//! step (see `reset_all_signals`), then ONLY the target signal is set. Without
//! this, mutations accumulate — e.g. a queued PermissionRequest would render its
//! modal on top of the board/terminal/diff snapshots. Each PNG now shows one
//! clean, isolated state.
//!
//! HARDWARE CAVEAT (RTX 2060 + nvidia / Wayland): WebKitGTK with the DMABUF
//! renderer paints black (Dioxus #4505). We force the env vars below BEFORE
//! launch; the runner should also export them.

use std::cell::Cell;
use std::fs::File;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use dioxus::desktop::tao::window::WindowBuilder;
use dioxus::desktop::{use_window, Config, DesktopContext, LogicalSize};
use dioxus::prelude::*;

use apohara_desktop_dioxus::state::code_diff::{self, Diff};
use apohara_desktop_dioxus::state::permissions::{
    self, PermissionRequestEvent, PermissionScope, PERMISSIONS,
};
use apohara_desktop_dioxus::state::running_status::{self, RunStatus};
use apohara_desktop_dioxus::state::toast_queue::{self, Toast, ToastLevel, TOAST_QUEUE};
use apohara_desktop_dioxus::state::view_mode::{set_view_mode, ViewMode};
use apohara_desktop_dioxus::App;

/// Where PNGs land for the human reviewer. Files are named
/// `apohara_baseline_<state>.png` — the pre-redesign reference set.
const OUT_DIR: &str = "/tmp";

/// Logical viewport (CSS px). Fixed so the layout — and the snapshot — is
/// deterministic and matches the production window.
const VIEWPORT_W: f64 = 1280.0;
const VIEWPORT_H: f64 = 800.0;

/// Settle time after mutating a signal before we read the DOM / snapshot.
const SETTLE: Duration = Duration::from_millis(450);

fn main() {
    // CRITICAL (RTX 2060 + nvidia): disable the DMABUF renderer and compositing
    // mode or the snapshot comes back all-black. Set BEFORE launch so the very
    // first WebKitGTK context is created with them in effect.
    //
    // SAFETY: single-threaded program start, no other thread reads env yet.
    unsafe {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    // Deadman switch: if the driver wedges, exit non-zero so CI/cargo notices.
    let should_panic = Arc::new(AtomicBool::new(true));
    let should_panic_clone = should_panic.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(60));
        if should_panic_clone.load(Ordering::SeqCst) {
            eprintln!("[ui_visual] driver did not finish in 60s — exiting");
            std::process::exit(1);
        }
    });

    // A fixed window size keeps the Visible-region snapshot deterministic and
    // makes the central `1fr` grid track resolve against the real 1280px width.
    dioxus::LaunchBuilder::desktop()
        .with_cfg(
            Config::new().with_window(
                WindowBuilder::new()
                    .with_visible(false)
                    .with_inner_size(LogicalSize::new(VIEWPORT_W, VIEWPORT_H))
                    .with_resizable(false)
                    .with_title("apohara ui_visual"),
            ),
        )
        .launch(VisualHarness);

    should_panic.store(false, Ordering::SeqCst);
    println!("[ui_visual] done — PNGs in {OUT_DIR}");
}

/// Reset every global UI signal back to its default. Called before each step so
/// states never bleed into each other (fix #2). After this returns the UI is
/// the clean default: Idle status, Graph view, no diff, no toasts, no perms.
fn reset_all_signals() {
    // Permissions: clear both the pending prompts and the recorded responses.
    {
        let mut perms = PERMISSIONS.write();
        perms.pending.clear();
        perms.responses.clear();
    }
    // Toasts: empty the FIFO queue.
    TOAST_QUEUE.write().clear();
    // Diff: nothing to show.
    code_diff::clear();
    // Run status: back to Idle.
    running_status::set_status(RunStatus::Idle);
    // View: the default (Graph).
    set_view_mode(ViewMode::Graph);
}

/// One capture step: a human label, the PNG basename, and the mutation that
/// puts the UI into the desired *isolated* state. `apply` runs AFTER
/// `reset_all_signals`, so it only needs to set its own target signal.
struct Step {
    label: &'static str,
    file: &'static str,
    apply: fn(),
}

fn steps() -> Vec<Step> {
    vec![
        Step {
            label: "default 3-pane grid (Idle, Graph)",
            file: "apohara_baseline_default",
            // Pure default — reset already produced it.
            apply: || {},
        },
        Step {
            label: "RUNNING_STATUS = Dispatching",
            file: "apohara_baseline_dispatching",
            apply: || running_status::set_status(RunStatus::Dispatching),
        },
        Step {
            label: "Toast in TOAST_QUEUE",
            file: "apohara_baseline_toast",
            apply: || {
                toast_queue::push(Toast {
                    id: "visual-toast".into(),
                    level: ToastLevel::Success,
                    message: "Visual harness toast — dispatch complete.".into(),
                    created_at: std::time::Instant::now(),
                    ttl_ms: 60_000,
                });
            },
        },
        Step {
            label: "PermissionDialog active",
            file: "apohara_baseline_permission",
            apply: || {
                permissions::enqueue_permission_request(PermissionRequestEvent {
                    request_id: "visual-perm-1".into(),
                    tool: "claude-code-cli".into(),
                    suggested_pattern: "Bash(git push:*)".into(),
                    available_scopes: vec![
                        PermissionScope::Once,
                        PermissionScope::Session,
                        PermissionScope::Always,
                    ],
                    ts: 0,
                });
            },
        },
        Step {
            label: "VIEW_MODE = Graph",
            file: "apohara_baseline_view_graph",
            // Graph is the reset default; set explicitly for clarity.
            apply: || set_view_mode(ViewMode::Graph),
        },
        Step {
            label: "VIEW_MODE = Board",
            file: "apohara_baseline_view_board",
            apply: || set_view_mode(ViewMode::Board),
        },
        Step {
            label: "VIEW_MODE = Terminal",
            file: "apohara_baseline_view_terminal",
            apply: || set_view_mode(ViewMode::Terminal),
        },
        Step {
            label: "CODE_DIFF set (diff visible)",
            file: "apohara_baseline_diff",
            apply: || {
                code_diff::set(Diff {
                    unified: "--- a/src/lib.rs\n+++ b/src/lib.rs\n@@ -1,3 +1,4 @@\n \
                              fn main() {\n-    let x = 1;\n+    let x = 2;\n+    \
                              println!(\"{x}\");\n }\n"
                        .into(),
                    files_changed: vec!["src/lib.rs".into()],
                    provider_winner: "claude-code-cli".into(),
                });
            },
        },
    ]
}

/// Root harness component. Mounts the real `App` and runs a single driver
/// `use_future` that walks every state, asserts the DOM, and snapshots.
#[component]
fn VisualHarness() -> Element {
    // Run the driver exactly once. `use_future` already polls its future a
    // single time per mount, but a one-shot guard keeps it idempotent if the
    // component re-renders.
    let started = use_hook(|| Rc::new(Cell::new(false)));
    use_future(move || {
        let started = started.clone();
        async move {
            if started.replace(true) {
                return;
            }

            // Grab the desktop context (Rc<DesktopService>) on the main thread.
            let desktop = use_window();

            // Let the initial App mount + first paint complete before we start.
            tokio::time::sleep(Duration::from_millis(900)).await;

            // Fix #1: a hidden tao window never gives the WebKit widget a
            // physical size, so its viewport is 0x0 and the central `1fr`
            // collapses. Force the widget to the logical viewport and pump the
            // GTK loop so WebKit re-lays-out at 1280px before we assert/snapshot.
            force_viewport_size(&desktop).await;
            // Let the relayout settle.
            tokio::time::sleep(Duration::from_millis(400)).await;

            // --- ASSERT: the default 3-pane grid layout via computed CSS ----
            // With the viewport forced to 1280px, the central `1fr` track must
            // now resolve wide (~600px), not the collapsed ~130px.
            run_grid_assert().await;

            for step in steps() {
                // Fix #2: wipe all signals, then set ONLY this step's target.
                reset_all_signals();
                (step.apply)();
                // Give the reconciler a tick to flush the mutation to the webview.
                tokio::time::sleep(SETTLE).await;

                // Fix #2 verification: log which overlays are live in the DOM so
                // the reviewer can confirm states are isolated (e.g. the
                // permission modal must NOT be present on the diff/board steps).
                assert_isolation(step.label).await;

                match snapshot_png(&desktop, step.file).await {
                    Ok(path) => println!("[ui_visual] captured '{}' -> {path}", step.label),
                    Err(e) => {
                        eprintln!("[ui_visual] snapshot FAILED for '{}': {e}", step.label)
                    }
                }
            }

            // All states captured — close the window so the event loop exits.
            desktop.close();
        }
    });

    rsx! { App {} }
}

/// Read the real computed layout of `.apohara-grid` from the live DOM and log
/// it as JSON. Validates `display: grid`, the two fixed side tracks, and — the
/// point of the viewport fix — that the central `1fr` track is WIDE.
async fn run_grid_assert() {
    let js = r#"
        let el = document.querySelector('.apohara-grid');
        if (!el) { return JSON.stringify({error: 'no .apohara-grid'}); }
        let s = getComputedStyle(el);
        let cols = s.gridTemplateColumns;
        // Parse the resolved px widths so we can assert the central track width.
        let widths = cols.split(/\s+/).map(t => parseFloat(t)).filter(n => !isNaN(n));
        return JSON.stringify({
            display: s.display,
            cols: cols,
            rows: s.gridTemplateRows,
            centerTrackPx: widths.length === 3 ? widths[1] : null,
            viewportW: window.innerWidth,
            viewportH: window.innerHeight,
        });
    "#;

    match document::eval(js).await {
        Ok(val) => {
            let json = val
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| val.to_string());
            println!("[ui_visual] grid assert JSON: {json}");

            // Soft structural checks — logged, not panicked, so one signal
            // glitch never strands the remaining snapshots.
            if !json.contains("\"display\":\"grid\"") {
                eprintln!("[ui_visual] WARN: grid display is not 'grid'");
            }
            // Computed `grid-template-columns` resolves `1fr` to a pixel value,
            // so we check the two fixed tracks (280px / 360px) rather than the
            // literal "280px 1fr 360px" authored string.
            if !json.contains("280px") || !json.contains("360px") {
                eprintln!("[ui_visual] WARN: grid columns missing 280px/360px tracks");
            }
            // Viewport fix verification: with a 1280px window, the central
            // `1fr` track is ~1280 - 280 - 360 - padding ≈ 616px. Anything
            // under ~400px means we're still measuring content width, not the
            // viewport (i.e. the FullDocument collapse the fix was meant to
            // kill).
            if let Some(center) = extract_center_track(&json) {
                if center < 400.0 {
                    eprintln!(
                        "[ui_visual] WARN: central track collapsed to {center}px \
                         — viewport fix not taking effect (expected ~600px)"
                    );
                } else {
                    println!(
                        "[ui_visual] OK: central `1fr` track resolved wide ({center}px)"
                    );
                }
            }
        }
        Err(e) => eprintln!("[ui_visual] grid assert eval FAILED: {e:?}"),
    }
}

/// Log which overlays are live in the DOM for the current step so the reviewer
/// can confirm signal isolation (fix #2). Reports the permission-dialog,
/// rendered `.toast`, and code-diff-pane counts. The driver only sets one
/// target signal per step, so exactly one of these should be active at a time
/// (besides the always-present empty diff placeholder).
async fn assert_isolation(label: &str) {
    let js = r#"
        return JSON.stringify({
            permissionDialogs: document.querySelectorAll('[data-testid="permission-dialog"]').length,
            toasts: document.querySelectorAll('.toast-container .toast').length,
            diffPanes: document.querySelectorAll('[data-testid="code-diff-pane"]').length,
            diffEmpty: document.querySelectorAll('[data-testid="code-diff-empty"]').length,
        });
    "#;

    match document::eval(js).await {
        Ok(val) => {
            let json = val
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| val.to_string());
            println!("[ui_visual] isolation [{label}]: {json}");
        }
        Err(e) => eprintln!("[ui_visual] isolation eval FAILED for '{label}': {e:?}"),
    }
}

/// Pull the numeric `centerTrackPx` out of the asserted JSON blob without a
/// JSON dependency (the value is a bare number, e.g. `"centerTrackPx":616.5`).
fn extract_center_track(json: &str) -> Option<f64> {
    let key = "\"centerTrackPx\":";
    let start = json.find(key)? + key.len();
    let rest = &json[start..];
    let end = rest
        .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-'))
        .unwrap_or(rest.len());
    rest[..end].parse::<f64>().ok()
}

/// Force the WebKit `GtkWidget` (and its toplevel) to the logical viewport size
/// and pump the GTK loop so the layout settles. A hidden tao window leaves the
/// webview unassigned (0x0 viewport), collapsing the grid's `1fr`. After this,
/// `window.innerWidth == 1280` and the central track resolves wide (fix #1).
///
/// Runs on glib's `MainContext` (the GTK thread) where touching widgets is
/// legal, then returns once the work is scheduled+done.
async fn force_viewport_size(desktop: &DesktopContext) {
    use wry::WebViewExtUnix;

    let webkit_view: webkit2gtk::WebView = desktop.webview.webview();
    let (tx, rx) = futures_channel::oneshot::channel::<()>();

    glib::MainContext::default().spawn_local(async move {
        use glib::Cast;
        use gtk::prelude::{GtkWindowExt, WidgetExt};

        let w = VIEWPORT_W as i32;
        let h = VIEWPORT_H as i32;
        let alloc = gtk::Allocation::new(0, 0, w, h);

        // Walk up to the toplevel GtkWindow and pin its size. A hidden window
        // is never sized by the WM, so we set it ourselves.
        if let Some(toplevel) = webkit_view.toplevel() {
            if let Ok(win) = toplevel.clone().downcast::<gtk::Window>() {
                win.set_default_size(w, h);
                win.resize(w, h);
                win.set_size_request(w, h);
                // Realize (but do NOT show) so the widget hierarchy gets a GDK
                // window and can be allocated without becoming visible.
                win.realize();
            }
            toplevel.set_size_request(w, h);
            toplevel.size_allocate(&alloc);
        }

        // Pin and force-allocate the webview widget itself — this is what
        // drives WebKit's viewport. realize + explicit size_allocate sidesteps
        // the WM, which never runs for a hidden window.
        webkit_view.set_size_request(w, h);
        webkit_view.realize();
        webkit_view.size_allocate(&alloc);

        // Pump the GTK loop so the allocation propagates and WebKit re-runs
        // layout at the new viewport.
        for _ in 0..200 {
            gtk::main_iteration_do(false);
        }

        let _ = tx.send(());
    });

    let _ = rx.await;
}

/// Snapshot the live WebKitGTK surface to `<OUT_DIR>/<file>.png`.
///
/// Runs the GTK/WebKit/cairo work on glib's default `MainContext` (the GTK main
/// thread) via `spawn_local`, then awaits the PNG-write result back here.
///
/// Uses `SnapshotRegion::FullDocument`: a hidden tao window can't snapshot the
/// `Visible` region (no realized surface), but with the viewport forced to
/// 1280px (see `force_viewport_size`) the document is laid out at full viewport
/// width, so FullDocument captures the real layout — central `1fr` track wide.
async fn snapshot_png(desktop: &DesktopContext, file: &str) -> Result<String, String> {
    use wry::WebViewExtUnix;

    // wry::WebView -> webkit2gtk::WebView (cheap clone of the GObject handle).
    let webkit_view: webkit2gtk::WebView = desktop.webview.webview();
    let out_path = format!("{OUT_DIR}/{file}.png");
    let out_path_for_task = out_path.clone();

    let (tx, rx) = futures_channel::oneshot::channel::<Result<(), String>>();

    // Hop onto the GTK main context. We are already on the main thread (dioxus
    // futures poll there), so this schedules the snapshot on glib's loop where
    // WebKit/cairo are legal to touch.
    glib::MainContext::default().spawn_local(async move {
        use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

        let result = async {
            let surface = webkit_view
                .snapshot_future(SnapshotRegion::FullDocument, SnapshotOptions::NONE)
                .await
                .map_err(|e| format!("snapshot_future error: {e}"))?;

            let mut f =
                File::create(&out_path_for_task).map_err(|e| format!("create png: {e}"))?;
            surface
                .write_to_png(&mut f)
                .map_err(|e| format!("write_to_png: {e}"))?;
            Ok::<(), String>(())
        }
        .await;

        let _ = tx.send(result);
    });

    rx.await
        .map_err(|_| "snapshot task dropped before completing".to_string())?
        .map(|()| out_path)
}
