use std::{
    io,
    os::windows::io::AsRawSocket,
    process::{Child, Command},
    sync::Mutex,
    task::{Context, Poll},
};

use tokio::net::{TcpListener, TcpStream};
use windows_sys::Win32::Foundation::{HANDLE_FLAG_INHERIT, SetHandleInformation};

// Acceptance and process creation must share the same inheritance lock.
static INHERITANCE_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn with_spawn_lock<T>(action: impl FnOnce() -> T) -> T {
    let _guard = INHERITANCE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    action()
}

pub(crate) fn spawn(command: &mut Command) -> io::Result<Child> {
    with_spawn_lock(|| command.spawn())
}

pub(crate) fn poll_accept(
    listener: &TcpListener,
    context: &mut Context<'_>,
) -> Poll<io::Result<(TcpStream, std::net::SocketAddr)>> {
    let _guard = INHERITANCE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match listener.poll_accept(context) {
        Poll::Ready(Ok((stream, address))) => {
            let result = unsafe {
                SetHandleInformation(stream.as_raw_socket() as _, HANDLE_FLAG_INHERIT, 0)
            };
            if result == 0 {
                let error = io::Error::last_os_error();
                drop(stream);
                return Poll::Ready(Err(error));
            }
            Poll::Ready(Ok((stream, address)))
        }
        result => result,
    }
}
