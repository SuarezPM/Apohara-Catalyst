// Apohara desktop — Tauri v2 entry point.

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let plan_status_cache = Arc::new(apohara_spec::plan_status_cache::PlanStatusCache::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell()) // placeholder until real plugins land
        .manage(plan_status_cache)
        .invoke_handler(tauri::generate_handler![
            open_event_ledger,
            apohara_dispatch::tauri_bridge::rust_dispatch,
            apohara_verification::tauri_bridge::quality_gates_evaluate,
            apohara_safety::tauri_bridge::safety_check_permission,
            apohara_safety::tauri_bridge::safety_analyze_bash_compound,
            apohara_safety::tauri_bridge::safety_match_pattern,
            apohara_spec::tauri_bridge::spec_load_plan,
            apohara_spec::tauri_bridge::spec_get_plan_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running apohara-desktop");
}

// Stub plugin (avoids needing a real tauri-plugin-shell dep at scaffold time).
// Tauri 2.11 added a second generic on `plugin::Builder` (`C: DeserializeOwned`)
// that needs to be pinned explicitly when the builder isn't used with config.
fn tauri_plugin_shell() -> impl tauri::plugin::Plugin<tauri::Wry> {
    tauri::plugin::Builder::<tauri::Wry, ()>::new("shell").build()
}

#[tauri::command]
fn open_event_ledger(run_id: String) -> Result<String, String> {
    // M017.x: spawn the orchestrator's `apohara replay --dry-run <run-id>`
    // and return the resolved ledger path. For now a stub.
    Ok(format!(".events/run-{run_id}.jsonl"))
}
