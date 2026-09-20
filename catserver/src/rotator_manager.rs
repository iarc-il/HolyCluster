use std::sync::{Arc, RwLock};

use crate::{
    device_actor::{Worker, WorkerStopped},
    rotator::{Rotator, RotatorError, RotatorStatus},
    rotator_actor::{Command, RotatorFactory, spawn},
    rotator_config::{RotatorConfig, RotatorConfigError},
};

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum RotatorConnectionState {
    Connected,
    Disconnected,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RotatorSnapshot {
    pub selected: String,
    pub connection: RotatorConnectionState,
    pub last_error: Option<RotatorError>,
    pub config: RotatorConfig,
    pub last_status: RotatorStatus,
    pub target_azimuth: Option<f64>,
}

#[derive(Debug)]
pub enum RotatorManagerError {
    InvalidAzimuth,
    InvalidConfig(RotatorConfigError),
    Operation(RotatorError),
    WorkerStopped,
    WorkerStart(std::io::Error),
}

impl std::fmt::Display for RotatorManagerError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidAzimuth => write!(formatter, "rotator azimuth must be finite"),
            Self::InvalidConfig(error) => {
                write!(formatter, "invalid rotator configuration: {error}")
            }
            Self::Operation(error) => error.fmt(formatter),
            Self::WorkerStopped => write!(formatter, "rotator worker stopped"),
            Self::WorkerStart(error) => {
                write!(formatter, "failed to start rotator worker: {error}")
            }
        }
    }
}

impl std::error::Error for RotatorManagerError {}

#[derive(Clone)]
pub struct RotatorManager {
    worker: Arc<Worker<Command>>,
    snapshot: Arc<RwLock<RotatorSnapshot>>,
}

impl RotatorManager {
    pub fn new(config: RotatorConfig) -> Result<Self, RotatorManagerError> {
        config
            .validate()
            .map_err(RotatorManagerError::InvalidConfig)?;
        let snapshot = Arc::new(RwLock::new(RotatorSnapshot {
            selected: "unconfigured".into(),
            connection: RotatorConnectionState::Disconnected,
            last_error: None,
            config,
            last_status: RotatorStatus::disconnected("unconfigured"),
            target_azimuth: None,
        }));
        Ok(Self {
            worker: Arc::new(spawn(Arc::clone(&snapshot))?),
            snapshot,
        })
    }

    pub async fn replace(
        &self,
        config: RotatorConfig,
        selected: impl Into<String>,
        factory: impl Fn() -> Box<dyn Rotator> + Send + Sync + 'static,
    ) -> Result<(), RotatorManagerError> {
        self.replace_inner(config, selected.into(), Arc::new(factory), false)
            .await
    }

    pub async fn replace_and_persist(
        &self,
        config: RotatorConfig,
        selected: impl Into<String>,
        factory: impl Fn() -> Box<dyn Rotator> + Send + Sync + 'static,
    ) -> Result<(), RotatorManagerError> {
        self.replace_inner(config, selected.into(), Arc::new(factory), true)
            .await
    }

    pub async fn retry(&self) -> Result<(), RotatorManagerError> {
        self.call(Command::Retry).await
    }

    pub async fn set_azimuth(&self, azimuth: f64) -> Result<(), RotatorManagerError> {
        if !azimuth.is_finite() {
            return Err(RotatorManagerError::InvalidAzimuth);
        }
        self.worker
            .request(|reply| Command::SetAzimuth(azimuth, reply))
            .await
            .map_err(map_worker_stopped)?
            .map_err(RotatorManagerError::Operation)
    }

    pub async fn poll_status(&self) -> Result<(), RotatorManagerError> {
        self.call(Command::Poll).await
    }

    pub fn snapshot(&self) -> RotatorSnapshot {
        self.snapshot
            .read()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn status(&self) -> RotatorStatus {
        self.snapshot().last_status
    }

    pub async fn shutdown(&self) -> Result<(), RotatorManagerError> {
        self.worker
            .request(Command::Shutdown)
            .await
            .map_err(map_worker_stopped)?;
        self.worker.join().await.map_err(map_worker_stopped)
    }

    async fn replace_inner(
        &self,
        config: RotatorConfig,
        selected: String,
        factory: RotatorFactory,
        persist: bool,
    ) -> Result<(), RotatorManagerError> {
        config
            .validate()
            .map_err(RotatorManagerError::InvalidConfig)?;
        self.worker
            .request(|reply| Command::Replace {
                config,
                selected,
                factory,
                persist,
                reply,
            })
            .await
            .map_err(map_worker_stopped)?
    }

    async fn call(
        &self,
        command: impl FnOnce(tokio::sync::oneshot::Sender<()>) -> Command,
    ) -> Result<(), RotatorManagerError> {
        self.worker
            .request(command)
            .await
            .map_err(map_worker_stopped)
    }
}

fn map_worker_stopped(_: WorkerStopped) -> RotatorManagerError {
    RotatorManagerError::WorkerStopped
}
