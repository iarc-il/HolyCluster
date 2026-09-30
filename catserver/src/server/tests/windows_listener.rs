use std::{
    fs,
    io::Read,
    process::{Child, Command, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use super::bind_local_listener;

const CHILD_READY_PATH: &str = "HOLYCLUSTER_SOCKET_CHILD_READY";

struct HelperChild(Child);

impl Drop for HelperChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[tokio::test]
async fn update_helper_does_not_keep_closed_listener_bound() {
    let listener = bind_local_listener(0, false).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    assert!(bind_local_listener(port, false).await.is_err());
    let test_module = module_path!().split_once("::").unwrap().1;
    let ready_path = std::env::temp_dir().join(format!(
        "catserver-socket-child-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut child = HelperChild(
        Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                &format!("{test_module}::inherited_listener_child"),
                "--ignored",
            ])
            .env(CHILD_READY_PATH, &ready_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    tokio::time::timeout(Duration::from_secs(10), async {
        while !ready_path.exists() {
            assert!(child.0.try_wait().unwrap().is_none(), "helper exited early");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("helper did not become ready");
    fs::remove_file(&ready_path).unwrap();
    assert!(child.0.try_wait().unwrap().is_none());

    drop(listener);

    let rebound = bind_local_listener(port, false)
        .await
        .expect("live helper inherited the closed listener");
    assert_eq!(rebound.local_addr().unwrap().port(), port);
    assert!(child.0.try_wait().unwrap().is_none());
}

#[test]
#[ignore]
fn inherited_listener_child() {
    let ready_path = std::env::var_os(CHILD_READY_PATH).expect("only run through the parent test");
    fs::write(ready_path, b"ready").unwrap();
    std::io::stdin().read_exact(&mut [0]).unwrap();
}
