//! Tests for the hallucination detector (ported from
//! `src/core/verification/hallucinationFlag.ts`).

use std::collections::HashSet;
use std::path::PathBuf;

use crate::hallucination_flag::{detect_hallucinations, DetectArgs};

#[test]
fn unresolved_relative_import_is_flagged() {
    let workspace = PathBuf::from("/nonexistent/workspace");
    let code = r#"import { foo } from "./missing";"#;
    let res = detect_hallucinations(&DetectArgs {
        code,
        existing_files: &[],
        workspace_path: &workspace,
        defined_symbols: None,
    });
    assert_eq!(res.hallucinations, vec!["./missing".to_string()]);
}

#[test]
fn relative_import_matched_via_existing_files_passes() {
    let workspace = PathBuf::from("/ws");
    let code = r#"import { foo } from "./util";"#;
    let existing = vec![PathBuf::from("/ws/util.ts")];
    let res = detect_hallucinations(&DetectArgs {
        code,
        existing_files: &existing,
        workspace_path: &workspace,
        defined_symbols: None,
    });
    assert!(res.hallucinations.is_empty(), "got: {:?}", res.hallucinations);
}

#[test]
fn bare_module_imports_are_ignored() {
    let workspace = PathBuf::from("/ws");
    // node_modules style — never relative-checked.
    let code = r#"import express from "express";"#;
    let res = detect_hallucinations(&DetectArgs {
        code,
        existing_files: &[],
        workspace_path: &workspace,
        defined_symbols: None,
    });
    assert!(res.hallucinations.is_empty());
}

#[test]
fn side_effect_relative_import_is_flagged() {
    let workspace = PathBuf::from("/nonexistent");
    let code = r#"import "./polyfill";"#;
    let res = detect_hallucinations(&DetectArgs {
        code,
        existing_files: &[],
        workspace_path: &workspace,
        defined_symbols: None,
    });
    assert_eq!(res.hallucinations, vec!["./polyfill".to_string()]);
}

#[test]
fn undefined_symbol_call_is_flagged_when_symbol_table_provided() {
    let workspace = PathBuf::from("/ws");
    let code = "doThing();\nknown();\n";
    let mut defined = HashSet::new();
    defined.insert("known".to_string());
    let res = detect_hallucinations(&DetectArgs {
        code,
        existing_files: &[],
        workspace_path: &workspace,
        defined_symbols: Some(&defined),
    });
    assert_eq!(res.hallucinations, vec!["doThing".to_string()]);
}

#[test]
fn symbol_table_absent_skips_call_check() {
    let workspace = PathBuf::from("/ws");
    let code = "undefinedFn();";
    let res = detect_hallucinations(&DetectArgs {
        code,
        existing_files: &[],
        workspace_path: &workspace,
        defined_symbols: None,
    });
    // Without a symbol table the branch is bypassed entirely (TS parity).
    assert!(res.hallucinations.is_empty());
}

#[test]
fn member_access_calls_are_ignored() {
    let workspace = PathBuf::from("/ws");
    // `obj.method()` must NOT trigger because `method` is a member, not
    // a root binding. The lookbehind emulation guards this.
    let code = "obj.method();\nrootCall();\n";
    let defined: HashSet<String> = HashSet::new();
    let res = detect_hallucinations(&DetectArgs {
        code,
        existing_files: &[],
        workspace_path: &workspace,
        defined_symbols: Some(&defined),
    });
    // Only rootCall flagged — method skipped because of `.` lookbehind.
    assert_eq!(res.hallucinations, vec!["rootCall".to_string()]);
}

#[test]
fn import_and_require_pseudo_calls_are_ignored() {
    let workspace = PathBuf::from("/ws");
    let code = r#"const x = import("./y"); const z = require("./y");"#;
    let defined: HashSet<String> = HashSet::new();
    let res = detect_hallucinations(&DetectArgs {
        code,
        existing_files: &[],
        workspace_path: &workspace,
        defined_symbols: Some(&defined),
    });
    // Neither `import` nor `require` flagged — both whitelisted.
    // The import("./y") string is also a *relative* import via the
    // import regex — flagged once.
    // Verify no false positive on the call side.
    assert!(!res.hallucinations.contains(&"import".to_string()));
    assert!(!res.hallucinations.contains(&"require".to_string()));
}

#[test]
fn empty_input_produces_empty_output() {
    let workspace = PathBuf::from("/ws");
    let res = detect_hallucinations(&DetectArgs {
        code: "",
        existing_files: &[],
        workspace_path: &workspace,
        defined_symbols: None,
    });
    assert!(res.hallucinations.is_empty());
}
