use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};

use anyhow::{Context, Result};
use axum::serve::Listener;
use tokio::net::{TcpListener, TcpStream};

pub(crate) async fn bind_local_listener(port: u16) -> Result<TcpListener> {
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
    bind_tcp_listener(address)
        .await
        .with_context(|| format!("cannot listen on {address}"))
}

pub(crate) async fn bind_startup_listener(
    port: u16,
    timeout: std::time::Duration,
) -> Result<TcpListener> {
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
    bind_required_listener(address, timeout)
        .await
        .with_context(|| {
            format!(
                "cannot claim required local port {address}; close the conflicting application and restart CAT Control"
            )
        })
}

pub(super) async fn bind_update_listener(
    port: u16,
    timeout: std::time::Duration,
) -> Result<TcpListener> {
    anyhow::ensure!(port != 0, "update restart requires the original port");
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
    bind_required_listener(address, timeout)
        .await
        .with_context(|| format!("cannot reclaim original update port {address}; close conflicting applications and restart CAT Control"))
}

async fn bind_required_listener(
    address: SocketAddrV4,
    timeout: std::time::Duration,
) -> std::io::Result<TcpListener> {
    let started = tokio::time::Instant::now();
    let deadline = started + timeout;
    let mut backoff = std::time::Duration::from_millis(100);
    let mut waiting = false;
    loop {
        match bind_tcp_listener(address).await {
            Ok(listener) => {
                if waiting {
                    tracing::info!(%address, elapsed_ms = started.elapsed().as_millis(), "Required local port released");
                }
                return Ok(listener);
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::AddrInUse
                    && tokio::time::Instant::now() < deadline =>
            {
                if !waiting {
                    tracing::warn!(%address, ?error, "Required local port is busy; waiting for release");
                    waiting = true;
                }
                tokio::time::sleep(
                    backoff.min(deadline.saturating_duration_since(tokio::time::Instant::now())),
                )
                .await;
                backoff = (backoff * 2).min(std::time::Duration::from_secs(1));
            }
            Err(error) => return Err(error),
        }
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

pub(crate) fn protect_listener(
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
