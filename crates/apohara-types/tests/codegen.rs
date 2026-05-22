use std::process::Command;

#[test]
fn generate_types_binary_outputs_file() {
    let tmp = tempfile::tempdir().unwrap();
    let out_dir = tmp.path().join("packages/apohara-shared");
    std::fs::create_dir_all(&out_dir).unwrap();

    let status = Command::new(env!("CARGO"))
        .args(["run", "--quiet", "--bin", "generate_types", "--features", "ts-export", "--", out_dir.to_str().unwrap()])
        .status()
        .expect("failed to run generate_types");
    assert!(status.success(), "binary exited non-zero");

    let types_file = out_dir.join("types.ts");
    assert!(types_file.exists(), "types.ts not generated at {}", types_file.display());
    let content = std::fs::read_to_string(&types_file).unwrap();
    assert!(content.contains("export"), "generated file lacks TS exports");
}

#[test]
fn generate_types_is_deterministic() {
    let tmp = tempfile::tempdir().unwrap();
    let out_dir = tmp.path().join("packages/apohara-shared");
    std::fs::create_dir_all(&out_dir).unwrap();

    // First invocation
    let status1 = Command::new(env!("CARGO"))
        .args(["run", "--quiet", "--bin", "generate_types", "--features", "ts-export", "--", out_dir.to_str().unwrap()])
        .status()
        .expect("first run");
    assert!(status1.success());
    let content1 = std::fs::read_to_string(out_dir.join("types.ts")).unwrap();

    // Second invocation
    let status2 = Command::new(env!("CARGO"))
        .args(["run", "--quiet", "--bin", "generate_types", "--features", "ts-export", "--", out_dir.to_str().unwrap()])
        .status()
        .expect("second run");
    assert!(status2.success());
    let content2 = std::fs::read_to_string(out_dir.join("types.ts")).unwrap();

    assert_eq!(content1, content2, "generate_types must be deterministic for generate-types:check to pass");
}
