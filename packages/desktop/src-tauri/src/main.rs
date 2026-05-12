// Tauri v2 desktop shell for Apohara. The actual UI lives in
// `../src/` and is served by Bun.serve during dev, then bundled into
// `../dist/` for production. This shell just opens the native window.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    apohara_desktop_lib::run();
}
