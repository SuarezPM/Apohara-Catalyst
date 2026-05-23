//! Tiny helper invoked by the E2E test in tests/integration/.
//!
//! Reads one line of JSON from stdin (a `HandshakeRequest`), negotiates with
//! the default server-supported protocol set, and writes a `HandshakeResponse`
//! line to stdout. On error, writes an error JSON object and exits with code 2.

use apohara_remote_worker::{handshake_decode, negotiate, HandshakeRequest, SUPPORTED_PROTOCOLS};
use serde::Serialize;
use std::io::{self, BufRead, Write};

#[derive(Serialize)]
struct Err<'a> {
    error: &'a str,
}

fn main() {
    let mut line = String::new();
    if let Err(e) = io::stdin().lock().read_line(&mut line) {
        let _ = writeln!(io::stderr(), "stdin read: {e}");
        std::process::exit(2);
    }
    let req: HandshakeRequest = match handshake_decode(line.as_bytes()) {
        Ok(r) => r,
        Err(e) => {
            let _ = writeln!(io::stdout(), "{}", serde_json::to_string(&Err { error: &e.to_string() }).unwrap());
            std::process::exit(2);
        }
    };
    match negotiate(&req, "1.0.0-dev", SUPPORTED_PROTOCOLS) {
        Ok(resp) => {
            let _ = writeln!(io::stdout(), "{}", serde_json::to_string(&resp).unwrap());
        }
        Err(e) => {
            let _ = writeln!(io::stdout(), "{}", serde_json::to_string(&Err { error: &e.to_string() }).unwrap());
            std::process::exit(2);
        }
    }
}
