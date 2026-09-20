use std::{
    sync::{Mutex, mpsc},
    thread::JoinHandle,
};

use tokio::sync::oneshot;

pub(crate) type DeviceFactory<T> = std::sync::Arc<dyn Fn() -> T + Send + Sync>;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) struct WorkerStopped;

pub(crate) struct Worker<C> {
    sender: mpsc::Sender<C>,
    join: Mutex<Option<JoinHandle<()>>>,
}

impl<C: Send + 'static> Worker<C> {
    pub(crate) fn spawn(
        name: &str,
        runner: impl FnOnce(mpsc::Receiver<C>) + Send + 'static,
    ) -> std::io::Result<Self> {
        Self::spawn_with(runner, |work| {
            std::thread::Builder::new().name(name.into()).spawn(work)
        })
    }

    pub(crate) fn spawn_with(
        runner: impl FnOnce(mpsc::Receiver<C>) + Send + 'static,
        spawn: impl FnOnce(Box<dyn FnOnce() + Send>) -> std::io::Result<JoinHandle<()>>,
    ) -> std::io::Result<Self> {
        let (sender, receiver) = mpsc::channel();
        let join = spawn(Box::new(move || runner(receiver)))?;
        Ok(Self {
            sender,
            join: Mutex::new(Some(join)),
        })
    }

    pub(crate) async fn request<R>(
        &self,
        command: impl FnOnce(oneshot::Sender<R>) -> C,
    ) -> Result<R, WorkerStopped> {
        let (reply, received) = oneshot::channel();
        self.sender
            .send(command(reply))
            .map_err(|_| WorkerStopped)?;
        received.await.map_err(|_| WorkerStopped)
    }

    pub(crate) async fn join(&self) -> Result<(), WorkerStopped> {
        let join = self
            .join
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take();
        if let Some(join) = join {
            tokio::task::spawn_blocking(move || join.join())
                .await
                .map_err(|_| WorkerStopped)?
                .map_err(|_| WorkerStopped)?;
        }
        Ok(())
    }
}

impl<C> Drop for Worker<C> {
    fn drop(&mut self) {
        let _ = self
            .join
            .get_mut()
            .unwrap_or_else(|error| error.into_inner())
            .take();
    }
}
