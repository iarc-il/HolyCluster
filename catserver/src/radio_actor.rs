use std::{
    sync::{Arc, Mutex, RwLock, mpsc},
    thread::JoinHandle,
};

use crate::{
    freq::Freq,
    radio_config::{ActiveRadioBackend, RadioConfig},
    radio_manager::{ConnectionState, RadioManagerError, RadioSnapshot},
    rig::{Mode, Radio, RadioInitError, Slot, Status},
};
use tokio::sync::oneshot;

pub(crate) type RadioFactory = Arc<dyn Fn() -> Box<dyn Radio> + Send + Sync>;

pub(crate) enum Command {
    Replace {
        config: RadioConfig,
        selected: ActiveRadioBackend,
        factory: RadioFactory,
        persist: bool,
        reply: oneshot::Sender<Result<(), RadioManagerError>>,
    },
    Retry(oneshot::Sender<()>),
    SetRig(u8, oneshot::Sender<()>),
    SetModeAndFrequency(Mode, Freq, oneshot::Sender<()>),
    Poll(oneshot::Sender<Status>),
    Shutdown(oneshot::Sender<()>),
}

pub(crate) struct Worker {
    pub(crate) sender: mpsc::Sender<Command>,
    join: Mutex<Option<JoinHandle<()>>>,
}

impl Worker {
    pub(crate) fn spawn(snapshot: Arc<RwLock<RadioSnapshot>>) -> Result<Self, RadioManagerError> {
        Self::spawn_with(snapshot, |work| {
            std::thread::Builder::new()
                .name("radio-worker".into())
                .spawn(work)
        })
    }

    pub(crate) fn spawn_with(
        snapshot: Arc<RwLock<RadioSnapshot>>,
        spawn: impl FnOnce(Box<dyn FnOnce() + Send>) -> std::io::Result<JoinHandle<()>>,
    ) -> Result<Self, RadioManagerError> {
        let (sender, receiver) = mpsc::channel();
        let join = spawn(Box::new(move || run(receiver, snapshot)))
            .map_err(RadioManagerError::WorkerStart)?;
        Ok(Self {
            sender,
            join: Mutex::new(Some(join)),
        })
    }

    pub(crate) fn take_join(&self) -> Option<JoinHandle<()>> {
        self.join
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self
            .join
            .get_mut()
            .unwrap_or_else(|error| error.into_inner())
            .take();
    }
}

fn run(receiver: mpsc::Receiver<Command>, snapshot: Arc<RwLock<RadioSnapshot>>) {
    let mut radio: Option<Box<dyn Radio>> = None;
    let mut factory: Option<RadioFactory> = None;
    while let Ok(command) = receiver.recv() {
        match command {
            Command::Replace {
                config,
                selected,
                factory: next_factory,
                persist,
                reply,
            } => {
                let mut candidate = next_factory();
                let init = candidate.init();
                let result = if persist {
                    config.save().map_err(RadioManagerError::InvalidConfig)
                } else {
                    Ok(())
                };
                if result.is_ok() {
                    publish(&snapshot, config, selected, init, candidate.get_status());
                    radio = Some(candidate);
                    factory = Some(next_factory);
                }
                let _ = reply.send(result);
            }
            Command::Retry(reply) => {
                if let Some(factory) = &factory {
                    let mut candidate = factory();
                    let init = candidate.init();
                    let state = snapshot
                        .read()
                        .unwrap_or_else(|error| error.into_inner())
                        .clone();
                    publish(
                        &snapshot,
                        state.config,
                        state.selected,
                        init,
                        candidate.get_status(),
                    );
                    radio = Some(candidate);
                }
                let _ = reply.send(());
            }
            Command::SetRig(rig, reply) => {
                if let Some(radio) = &mut radio {
                    radio.set_rig(rig);
                    publish_status(&snapshot, radio.get_status());
                }
                let _ = reply.send(());
            }
            Command::SetModeAndFrequency(mode, frequency, reply) => {
                if let Some(radio) = &mut radio {
                    radio.set_mode(mode);
                    radio.set_frequency(Slot::A, frequency);
                    publish_status(&snapshot, radio.get_status());
                }
                let _ = reply.send(());
            }
            Command::Poll(reply) => {
                let status = radio.as_mut().map_or_else(
                    || {
                        snapshot
                            .read()
                            .unwrap_or_else(|error| error.into_inner())
                            .last_status
                            .clone()
                    },
                    |radio| radio.get_status(),
                );
                publish_status(&snapshot, status.clone());
                let _ = reply.send(status);
            }
            Command::Shutdown(reply) => {
                drop(radio);
                let _ = reply.send(());
                break;
            }
        }
    }
}

fn publish(
    snapshot: &RwLock<RadioSnapshot>,
    config: RadioConfig,
    selected: ActiveRadioBackend,
    init: Result<(), RadioInitError>,
    status: Status,
) {
    let (connection, last_error) = match init {
        Ok(()) => (ConnectionState::Connected, None),
        Err(error) => (ConnectionState::Disconnected, Some(error)),
    };
    let mut snapshot = snapshot.write().unwrap_or_else(|error| error.into_inner());
    snapshot.config = config;
    snapshot.selected = selected;
    snapshot.connection = connection;
    snapshot.last_error = last_error;
    snapshot.last_status = status;
}

fn publish_status(snapshot: &RwLock<RadioSnapshot>, status: Status) {
    let mut snapshot = snapshot.write().unwrap_or_else(|error| error.into_inner());
    snapshot.connection = if status.status == "connected" {
        ConnectionState::Connected
    } else {
        ConnectionState::Disconnected
    };
    if snapshot.connection == ConnectionState::Connected {
        snapshot.last_error = None;
    }
    snapshot.last_status = status;
}
