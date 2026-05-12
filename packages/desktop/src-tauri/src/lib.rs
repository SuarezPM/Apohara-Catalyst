// Apohara desktop — Tauri v2 entry point.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell()) // placeholder until real plugins land
        .invoke_handler(tauri::generate_handler![open_event_ledger])
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
