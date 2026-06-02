//! Built-in MCP servers (ledger, runs, indexer, settings, commit).
//!
//! Each module exports a `build_<name>_tools(backend)` constructor that
//! returns the `ToolRegistration` list. Callers wire them onto an
//! `McpServer` instance from the base module. Servers that need
//! persistence accept a trait-backed handle so the crate does not pull
//! a SQLite dependency at this layer; the desktop / cli binary wires
//! the concrete bun-sqlite-replacement backend during bootstrap.

pub mod commit;
pub mod indexer;
pub mod ledger;
pub mod mesh;
/// US-F2.0a — concrete `MeshBackend` over the F0+F1 filesystem stores, so the
/// `apohara.mesh` server (above) goes live against real disk at bootstrap.
pub mod mesh_store;
pub mod runs;
pub mod settings;
