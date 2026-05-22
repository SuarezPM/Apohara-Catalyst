use apohara_persistence::{build_launchd_plist, build_systemd_user_unit, build_windows_schtasks};

#[test]
fn systemd_user_unit_includes_exec_start() {
    let unit = build_systemd_user_unit("apohara-daemon", "/usr/local/bin/apohara daemon");
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
    );
    assert!(cmd.contains("schtasks"));
    assert!(cmd.contains("/SC ONLOGON"));
    assert!(cmd.contains("Apohara Daemon"));
}
