use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};

use anyhow::{Context, Result};
use axum::serve::Listener;
use tokio::net::{TcpListener, TcpStream};

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

pub(super) fn protect_listener(
    listener: TcpListener,
) -> impl Listener<Io = TcpStream, Addr = SocketAddr> {
    #[cfg(windows)]
    {
        NonInheritedListener(listener)
    }
    #[cfg(not(windows))]
    listener
}

#[cfg(windows)]
struct NonInheritedListener(TcpListener);

#[cfg(windows)]
impl Listener for NonInheritedListener {
    type Io = TcpStream;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        loop {
            match std::future::poll_fn(|context| {
                crate::windows_sockets::poll_accept(&self.0, context)
            })
            .await
            {
                Ok(connection) => return connection,
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::ConnectionRefused
                            | std::io::ErrorKind::ConnectionAborted
                            | std::io::ErrorKind::ConnectionReset
                    ) => {}
                Err(error) => {
                    tracing::error!(?error, "Could not accept local connection");
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
            }
        }
    }

    fn local_addr(&self) -> std::io::Result<Self::Addr> {
        self.0.local_addr()
    }
}

#[cfg(all(test, windows))]
#[path = "tests/windows_listener.rs"]
mod tests;
