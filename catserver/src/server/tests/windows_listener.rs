use std::{
    fs,
    future::Future,
    io::Read,
    os::windows::io::AsRawSocket,
    process::{Child, Command, Stdio},
    task::{Context, Waker},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::serve::Listener;
use tokio::{io::AsyncReadExt, net::TcpSocket};
use windows_sys::Win32::Foundation::{GetHandleInformation, HANDLE_FLAG_INHERIT};

use super::{bind_local_listener, bind_update_listener, protect_listener};

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
    let listener = bind_local_listener(0).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    assert!(bind_local_listener(port).await.is_err());
    let mut child = spawn_helper().await;

    drop(listener);

    let rebound = bind_local_listener(port)
        .await
        .expect("live helper inherited the closed listener");
    assert_eq!(rebound.local_addr().unwrap().port(), port);
    assert!(child.0.try_wait().unwrap().is_none());
}

#[tokio::test]
async fn update_helper_does_not_keep_closed_connection_alive() {
    let mut listener = protect_listener(bind_local_listener(0).await.unwrap());
    let mut client = TcpSocket::new_v4()
        .unwrap()
        .connect(listener.local_addr().unwrap())
        .await
        .unwrap();
    let (connection, _) = listener.accept().await;
    let mut flags = 0;
    assert_ne!(
        unsafe { GetHandleInformation(connection.as_raw_socket() as _, &mut flags) },
        0
    );
    assert_eq!(flags & HANDLE_FLAG_INHERIT, 0);
    let mut child = spawn_helper().await;

    drop(connection);

    let received = tokio::time::timeout(Duration::from_secs(1), client.read(&mut [0]))
        .await
        .expect("live helper inherited the closed connection")
        .unwrap();
    assert_eq!(received, 0);
    assert!(child.0.try_wait().unwrap().is_none());
}

#[tokio::test]
async fn pending_accept_does_not_block_helper_spawn() {
    let mut listener = protect_listener(bind_local_listener(0).await.unwrap());
    let mut accepting = Box::pin(listener.accept());
    let mut context = Context::from_waker(Waker::noop());
    assert!(accepting.as_mut().poll(&mut context).is_pending());

    let mut child = spawn_helper().await;

    assert!(child.0.try_wait().unwrap().is_none());
}

#[tokio::test]
async fn broker_wait_does_not_block_loopback_accept() {
    let mut listener = protect_listener(bind_local_listener(0).await.unwrap());
    let mut broker = spawn_helper().await;
    let client = TcpSocket::new_v4()
        .unwrap()
        .connect(listener.local_addr().unwrap())
        .await
        .unwrap();
    let (connection, _) = tokio::time::timeout(Duration::from_secs(1), listener.accept())
        .await
        .expect("broker inheritance lock blocked status acceptance");
    assert!(broker.0.try_wait().unwrap().is_none());
    drop(connection);
    drop(client);
}

#[tokio::test]
async fn update_retry_keeps_the_original_port() {
    let occupied = bind_local_listener(0).await.unwrap();
    let port = occupied.local_addr().unwrap().port();
    let release = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        drop(occupied);
    });
    let rebound = bind_update_listener(port, Duration::from_secs(2))
        .await
        .unwrap();
    assert_eq!(rebound.local_addr().unwrap().port(), port);
    release.await.unwrap();
    assert!(
        bind_update_listener(port, Duration::from_millis(50))
            .await
            .is_err()
    );
}

async fn spawn_helper() -> HelperChild {
    let test_module = module_path!().split_once("::").unwrap().1;
    let ready_path = std::env::temp_dir().join(format!(
        "catserver-socket-child-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args([
            "--exact",
            &format!("{test_module}::inherited_listener_child"),
            "--ignored",
        ])
        .env(CHILD_READY_PATH, &ready_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = HelperChild(crate::windows_sockets::spawn(&mut command).unwrap());
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
    child
}

#[test]
#[ignore]
fn inherited_listener_child() {
    let ready_path = std::env::var_os(CHILD_READY_PATH).expect("only run through the parent test");
    crate::windows_sockets::with_spawn_lock(|| {
        fs::write(ready_path, b"ready").unwrap();
        std::io::stdin().read_exact(&mut [0]).unwrap();
    });
}
