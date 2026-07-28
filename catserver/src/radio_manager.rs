use std::sync::{Arc, RwLock};

use tokio::sync::oneshot;

use crate::{
    freq::Freq,
    radio_actor::{Command, RadioFactory, Worker},
    radio_config::{ActiveRadioBackend, RadioConfig, RadioConfigError},
    rig::{Mode, Radio, RadioInitError, Status},
};

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum ConnectionState {
    Connected,
    Disconnected,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct RadioSnapshot {
    pub selected: ActiveRadioBackend,
    pub connection: ConnectionState,
    pub last_error: Option<RadioInitError>,
    pub config: RadioConfig,
    pub last_status: Status,
}

#[derive(Debug)]
pub enum RadioManagerError {
    InvalidConfig(RadioConfigError),
    WorkerStopped,
    WorkerStart(std::io::Error),
}

impl std::fmt::Display for RadioManagerError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidConfig(error) => write!(formatter, "invalid radio configuration: {error}"),
            Self::WorkerStopped => write!(formatter, "radio worker stopped"),
            Self::WorkerStart(error) => write!(formatter, "failed to start radio worker: {error}"),
        }
    }
}

impl std::error::Error for RadioManagerError {}

#[derive(Clone)]
pub struct RadioManager {
    worker: Arc<Worker>,
    snapshot: Arc<RwLock<RadioSnapshot>>,
}

impl RadioManager {
    pub fn new(
        config: RadioConfig,
        selected: ActiveRadioBackend,
    ) -> Result<Self, RadioManagerError> {
        let snapshot = Arc::new(RwLock::new(RadioSnapshot {
            selected: selected.clone(),
            connection: ConnectionState::Disconnected,
            last_error: None,
            config: config.clone(),
            last_status: Status::disconnected(1),
        }));
        Ok(Self {
            worker: Arc::new(Worker::spawn(Arc::clone(&snapshot))?),
            snapshot,
        })
    }

    pub async fn replace(
        &self,
        config: RadioConfig,
        selected: ActiveRadioBackend,
        factory: impl Fn() -> Box<dyn Radio> + Send + Sync + 'static,
    ) -> Result<(), RadioManagerError> {
        self.replace_inner(config, selected, Arc::new(factory), false)
            .await
    }

    pub async fn replace_and_persist(
        &self,
        config: RadioConfig,
        selected: ActiveRadioBackend,
        factory: impl Fn() -> Box<dyn Radio> + Send + Sync + 'static,
    ) -> Result<(), RadioManagerError> {
        self.replace_inner(config, selected, Arc::new(factory), true)
            .await
    }

    pub async fn retry(&self) -> Result<(), RadioManagerError> {
        self.call(Command::Retry).await
    }
    pub async fn set_rig(&self, rig: u8) -> Result<(), RadioManagerError> {
        self.call(|reply| Command::SetRig(rig, reply)).await
    }
    pub async fn set_mode_and_frequency(
        &self,
        mode: Mode,
        frequency: Freq,
    ) -> Result<(), RadioManagerError> {
        self.call(|reply| Command::SetModeAndFrequency(mode, frequency, reply))
            .await
    }

    pub fn snapshot(&self) -> RadioSnapshot {
        self.snapshot
            .read()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn status(&self) -> Status {
        self.snapshot().last_status
    }

    pub async fn poll_status(&self) -> Status {
        let (reply, received) = oneshot::channel();
        if self.worker.sender.send(Command::Poll(reply)).is_ok()
            && let Ok(status) = received.await
        {
            return status;
        }
        self.status()
    }

    pub async fn shutdown(&self) -> Result<(), RadioManagerError> {
        let (reply, received) = oneshot::channel();
        self.worker
            .sender
            .send(Command::Shutdown(reply))
            .map_err(|_| RadioManagerError::WorkerStopped)?;
        received
            .await
            .map_err(|_| RadioManagerError::WorkerStopped)?;
        if let Some(join) = self.worker.take_join() {
            tokio::task::spawn_blocking(move || join.join())
                .await
                .map_err(|_| RadioManagerError::WorkerStopped)?
                .map_err(|_| RadioManagerError::WorkerStopped)?;
        }
        Ok(())
    }

    async fn replace_inner(
        &self,
        config: RadioConfig,
        selected: ActiveRadioBackend,
        factory: RadioFactory,
        persist: bool,
    ) -> Result<(), RadioManagerError> {
        config
            .validate()
            .map_err(RadioManagerError::InvalidConfig)?;
        let (reply, received) = oneshot::channel();
        self.worker
            .sender
            .send(Command::Replace {
                config,
                selected,
                factory,
                persist,
                reply,
            })
            .map_err(|_| RadioManagerError::WorkerStopped)?;
        received
            .await
            .map_err(|_| RadioManagerError::WorkerStopped)?
    }

    async fn call(
        &self,
        command: impl FnOnce(oneshot::Sender<()>) -> Command,
    ) -> Result<(), RadioManagerError> {
        let (reply, received) = oneshot::channel();
        self.worker
            .sender
            .send(command(reply))
            .map_err(|_| RadioManagerError::WorkerStopped)?;
        received.await.map_err(|_| RadioManagerError::WorkerStopped)
    }
}
