use std::net::{Ipv4Addr, SocketAddrV4};

use anyhow::{Context, Result};
use tokio::net::TcpListener;

pub(super) async fn bind_local_listener(port: u16, fallback_if_busy: bool) -> Result<TcpListener> {
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
    match bind_tcp_listener(address).await {
        Ok(listener) => Ok(listener),
        Err(error) if fallback_if_busy && error.kind() == std::io::ErrorKind::AddrInUse => {
            tracing::warn!(%address, ?error, "Local port busy; choosing free loopback port");
            Ok(bind_tcp_listener(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)).await?)
        }
        Err(error) => Err(error).with_context(|| format!("cannot listen on {address}")),
    }
}

async fn bind_tcp_listener(address: SocketAddrV4) -> std::io::Result<TcpListener> {
    #[cfg(windows)]
    {
        let socket = tokio::net::TcpSocket::new_v4()?;
        socket.bind(address.into())?;
        socket.listen(1024)
    }
    #[cfg(not(windows))]
    TcpListener::bind(address).await
}

#[cfg(all(test, windows))]
#[path = "tests/windows_listener.rs"]
mod tests;
