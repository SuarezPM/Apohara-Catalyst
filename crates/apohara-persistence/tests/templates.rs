use apohara_persistence::{
    build_launchd_plist, build_systemd_user_unit, build_windows_schtasks, PersistenceError,
};

#[test]
fn systemd_user_unit_includes_exec_start() {
    let unit = build_systemd_user_unit("apohara-daemon", "/usr/local/bin/apohara daemon")
        .expect("clean inputs should succeed");
    assert!(unit.contains("[Service]"));
    assert!(unit.contains("ExecStart=/usr/local/bin/apohara daemon"));
    assert!(unit.contains("Restart=on-failure"));
    assert!(unit.contains("[Install]"));
}

#[test]
fn launchd_plist_includes_program_arguments() {
    let plist =
        build_launchd_plist("com.apohara.daemon", &["/usr/local/bin/apohara", "daemon"]);
    assert!(plist.contains("<key>Label</key>"));
    assert!(plist.contains("<string>com.apohara.daemon</string>"));
    assert!(plist.contains("<string>/usr/local/bin/apohara</string>"));
    assert!(plist.contains("<key>RunAtLoad</key>"));
}

#[test]
fn schtasks_command_includes_sc_onlogon() {
    let cmd = build_windows_schtasks(
        "Apohara Daemon",
        "C:\\Program Files\\Apohara\\apohara.exe daemon",
    )
    .expect("clean inputs should succeed");
    assert!(cmd.contains("schtasks"));
    assert!(cmd.contains("/SC ONLOGON"));
    assert!(cmd.contains("Apohara Daemon"));
}

#[test]
fn systemd_unit_includes_user_level_invariant() {
    let unit = build_systemd_user_unit("my-svc", "/usr/bin/apohara serve")
        .expect("valid inputs should succeed");
    assert!(
        unit.contains("WantedBy=default.target"),
        "USER-LEVEL invariant broken: unit must target default.target, not multi-user.target"
    );
}

#[test]
fn systemd_rejects_newline_in_exec() {
    let res = build_systemd_user_unit("my-svc", "/usr/bin/apohara\nrm -rf /");
    assert!(matches!(
        res,
        Err(PersistenceError::InvalidInput {
            field: "exec_start",
            ..
        })
    ));
}

#[test]
fn systemd_rejects_percent_in_exec() {
    let res = build_systemd_user_unit("my-svc", "/usr/bin/apohara %H");
    assert!(matches!(
        res,
        Err(PersistenceError::InvalidInput { .. })
    ));
}

#[test]
fn systemd_rejects_prefix_specifier() {
    let res = build_systemd_user_unit("my-svc", "-/usr/bin/apohara");
    assert!(matches!(
        res,
        Err(PersistenceError::InvalidInput { .. })
    ));
}

#[test]
fn systemd_rejects_invalid_name() {
    let res = build_systemd_user_unit("my svc!", "/usr/bin/apohara");
    assert!(matches!(
        res,
        Err(PersistenceError::InvalidInput {
            field: "name",
            ..
        })
    ));
}

#[test]
fn launchd_plist_escapes_xml_entities() {
    let plist = build_launchd_plist(
        "com.example.app",
        &[
            "--flag=<value>",
            "a&b",
            "</string><key>RunAtRoot</key><true/><string>",
        ],
    );
    assert!(plist.contains("&lt;value&gt;"), "< not escaped");
    assert!(plist.contains("a&amp;b"), "& not escaped");
    assert!(
        !plist.contains("<key>RunAtRoot</key>"),
        "injection succeeded — XML escape broken"
    );
}

#[test]
fn launchd_plist_escapes_label() {
    let plist = build_launchd_plist("evil&<label>", &["--ok"]);
    assert!(plist.contains("evil&amp;&lt;label&gt;"));
}

#[test]
fn schtasks_rejects_ampersand_in_name() {
    let res = build_windows_schtasks("Foo & rm", "C:\\apohara.exe");
    assert!(matches!(
        res,
        Err(PersistenceError::InvalidInput {
            field: "task_name",
            ..
        })
    ));
}

#[test]
fn schtasks_rejects_quote_in_exec() {
    let res = build_windows_schtasks("apohara", "C:\\apo \"--evil\"");
    assert!(matches!(
        res,
        Err(PersistenceError::InvalidInput {
            field: "exec",
            ..
        })
    ));
}

#[test]
fn schtasks_happy_path() {
    let cmd = build_windows_schtasks("apohara", "C:\\apohara.exe")
        .expect("clean inputs should succeed");
    assert!(cmd.contains("/TN \"apohara\""));
    assert!(cmd.contains("/SC ONLOGON"));
    assert!(!cmd.contains("/RU SYSTEM"));
}
