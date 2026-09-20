use std::sync::{Arc, RwLock, mpsc};

use crate::{
    device_actor::{DeviceFactory, Worker},
    freq::Freq,
    radio_config::{ActiveRadioBackend, RadioConfig},
    radio_manager::{ConnectionState, RadioManagerError, RadioSnapshot},
    rig::{Mode, Radio, RadioInitError, Slot, Status},
};
use tokio::sync::oneshot;

pub(crate) type RadioFactory = DeviceFactory<Box<dyn Radio>>;

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

pub(crate) fn spawn(
    snapshot: Arc<RwLock<RadioSnapshot>>,
) -> Result<Worker<Command>, RadioManagerError> {
    Worker::spawn("radio-worker", move |receiver| run(receiver, snapshot))
        .map_err(RadioManagerError::WorkerStart)
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
