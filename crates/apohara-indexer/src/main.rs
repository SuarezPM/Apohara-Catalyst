//! Apohara indexer CLI.
//!
//! Usage:
//!   apohara-indexer index <db_path> <file>...
//!   apohara-indexer query <db_path> <text>

use anyhow::{bail, Result};
use apohara_indexer::{insert_chunk, knn_query, open_db, IndexedChunk};
use std::env;
use std::path::{Path, PathBuf};

fn main() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: apohara-indexer <index|query> <db_path> [<args>...]");
        std::process::exit(1);
    }
    let cmd = args[1].as_str();
    let db_path = PathBuf::from(&args[2]);
    let rest = &args[3..];

    match cmd {
        "index" => cmd_index(&db_path, rest),
        "query" => cmd_query(&db_path, rest),
        other => {
            eprintln!("Unknown command: {}", other);
            std::process::exit(2);
        }
    }
}

fn cmd_index(db_path: &Path, files: &[String]) -> Result<()> {
    if files.is_empty() {
        bail!("index command requires at least one file path");
    }
    let conn = open_db(db_path)?;
    for path in files {
        let body = std::fs::read_to_string(path)?;
        let lines = body.lines().count() as u32;
        let chunk = IndexedChunk {
            id: format!("{}:1-{}", path, lines.max(1)),
            file_path: path.clone(),
            start_line: 1,
            end_line: lines.max(1),
            body,
        };
        insert_chunk(&conn, &chunk)?;
    }
    Ok(())
}

fn cmd_query(db_path: &Path, args: &[String]) -> Result<()> {
    if args.is_empty() {
        bail!("query command requires a search string");
    }
    let conn = open_db(db_path)?;
    let k = 5usize;
    let hits = knn_query(&conn, &args.join(" "), k)?;
    for hit in hits {
        println!("{}\t{:.4}", hit.chunk_id, hit.distance);
    }
    Ok(())
}
