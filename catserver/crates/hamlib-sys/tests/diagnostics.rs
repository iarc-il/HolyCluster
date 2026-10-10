#[cfg(target_os = "linux")]
#[test]
fn native_diagnostic_storage_history_and_concurrency() {
    // Compile and link the maintained C tests against this build's actual archive,
    // not a system Hamlib or mock. Windows builds compile the same patched source;
    // the pthread-barrier runtime test requires Linux.
    let output = std::process::Command::new("bash")
        .arg(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/native/run.sh"))
        .arg(env!("HAMLIB_SYS_NATIVE_PREFIX"))
        .output()
        .expect("run the native Hamlib diagnostic regression");
    println!("{}", String::from_utf8_lossy(&output.stdout));
    assert!(
        output.status.success(),
        "native diagnostics failed: {}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
