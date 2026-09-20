use std::{
    sync::{Arc, RwLock, mpsc},
    time::{Duration, Instant},
};

use crate::{
    device_actor::{DeviceFactory, Worker},
    freq::Freq,
    radio_config::{ActiveRadioBackend, RadioConfig},
    radio_manager::{ConnectionState, RadioManagerError, RadioSnapshot},
    rig::{Mode, Radio, RadioInitError, RadioOperationError, Slot, Status},
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
    Test {
        factory: RadioFactory,
        reply: oneshot::Sender<Result<(), RadioInitError>>,
    },
    Retry(oneshot::Sender<()>),
    SetRig(u8, oneshot::Sender<Result<(), RadioOperationError>>),
    SetModeAndFrequency(Mode, Freq, oneshot::Sender<Result<(), RadioOperationError>>),
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
    let mut retry_delay = Duration::from_secs(1);
    let mut next_action: Option<Instant> = None;
    loop {
        let received = match next_action {
            Some(deadline) => {
                receiver.recv_timeout(deadline.saturating_duration_since(Instant::now()))
            }
            None => receiver
                .recv()
                .map_err(|_| mpsc::RecvTimeoutError::Disconnected),
        };
        let command = match received {
            Ok(command) => command,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let connected = snapshot
                    .read()
                    .unwrap_or_else(|error| error.into_inner())
                    .connection
                    == ConnectionState::Connected;
                if connected {
                    next_action = radio.as_mut().map(|radio| {
                        let connected = publish_status(&snapshot, radio.get_status());
                        schedule_after_attempt(connected, &mut retry_delay)
                    });
                } else if let Some(factory) = &factory {
                    let connected = replace_from_factory(&snapshot, factory, &mut radio);
                    next_action = Some(schedule_after_attempt(connected, &mut retry_delay));
                } else {
                    next_action = None;
                }
                continue;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };
        match command {
            Command::Replace {
                config,
                selected,
                factory: next_factory,
                persist,
                reply,
            } => {
                let result = if persist {
                    config.save().map_err(RadioManagerError::InvalidConfig)
                } else {
                    Ok(())
                };
                if result.is_ok() {
                    let mut candidate = next_factory();
                    let init = candidate.init();
                    let connected =
                        publish(&snapshot, config, selected, init, candidate.get_status());
                    radio = Some(candidate);
                    factory = Some(next_factory);
                    retry_delay = Duration::from_secs(1);
                    next_action = Some(schedule_after_attempt(connected, &mut retry_delay));
                }
                let _ = reply.send(result);
            }
            Command::Test { factory, reply } => {
                let mut candidate = factory();
                let result = candidate.init();
                drop(candidate);
                let _ = reply.send(result);
            }
            Command::Retry(reply) => {
                if let Some(factory) = &factory {
                    let connected = replace_from_factory(&snapshot, factory, &mut radio);
                    next_action = Some(schedule_after_attempt(connected, &mut retry_delay));
                }
                let _ = reply.send(());
            }
            Command::SetRig(rig, reply) => {
                let result = radio.as_mut().map_or_else(
                    || {
                        Err(RadioOperationError::new(
                            rig,
                            "select rig",
                            "radio unavailable",
                        ))
                    },
                    |radio| radio.set_rig(rig),
                );
                let connected = publish_operation_result(&snapshot, radio.as_mut(), &result);
                next_action = factory
                    .as_ref()
                    .map(|_| schedule_after_attempt(connected, &mut retry_delay));
                let _ = reply.send(result);
            }
            Command::SetModeAndFrequency(mode, frequency, reply) => {
                let current_rig = snapshot
                    .read()
                    .unwrap_or_else(|error| error.into_inner())
                    .last_status
                    .current_rig;
                let result = radio.as_mut().map_or_else(
                    || {
                        Err(RadioOperationError::new(
                            current_rig,
                            "set mode and frequency",
                            "radio unavailable",
                        ))
                    },
                    |radio| {
                        radio.set_mode(mode)?;
                        radio.set_frequency(Slot::A, frequency)
                    },
                );
                let connected = publish_operation_result(&snapshot, radio.as_mut(), &result);
                next_action = factory
                    .as_ref()
                    .map(|_| schedule_after_attempt(connected, &mut retry_delay));
                let _ = reply.send(result);
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
                let connected = publish_status(&snapshot, status.clone());
                if radio.is_some() {
                    next_action = Some(schedule_after_attempt(connected, &mut retry_delay));
                }
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

fn replace_from_factory(
    snapshot: &RwLock<RadioSnapshot>,
    factory: &RadioFactory,
    radio: &mut Option<Box<dyn Radio>>,
) -> bool {
    let mut candidate = factory();
    let init = candidate.init();
    let state = snapshot
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .clone();
    let connected = publish(
        snapshot,
        state.config,
        state.selected,
        init,
        candidate.get_status(),
    );
    *radio = Some(candidate);
    connected
}

fn schedule_after_attempt(connected: bool, retry_delay: &mut Duration) -> Instant {
    if connected {
        *retry_delay = Duration::from_secs(1);
        Instant::now() + Duration::from_millis(500)
    } else {
        let delay = *retry_delay;
        *retry_delay = (*retry_delay * 2).min(Duration::from_secs(30));
        Instant::now() + delay
    }
}

fn publish(
    snapshot: &RwLock<RadioSnapshot>,
    config: RadioConfig,
    selected: ActiveRadioBackend,
    init: Result<(), RadioInitError>,
    status: Status,
) -> bool {
    let (connection, last_error) = match init {
        Ok(()) if status.status == "connected" => (ConnectionState::Connected, None),
        Ok(()) => (ConnectionState::Disconnected, None),
        Err(error) => (ConnectionState::Disconnected, Some(error)),
    };
    let mut snapshot = snapshot.write().unwrap_or_else(|error| error.into_inner());
    snapshot.config = config;
    snapshot.selected = selected;
    snapshot.connection = connection;
    snapshot.last_error = last_error;
    snapshot.last_operation_error = None;
    snapshot.last_status = status;
    snapshot.connection == ConnectionState::Connected
}

fn publish_status(snapshot: &RwLock<RadioSnapshot>, status: Status) -> bool {
    let mut snapshot = snapshot.write().unwrap_or_else(|error| error.into_inner());
    snapshot.connection = if status.status == "connected" {
        ConnectionState::Connected
    } else {
        ConnectionState::Disconnected
    };
    if snapshot.connection == ConnectionState::Connected {
        snapshot.last_error = None;
        snapshot.last_operation_error = None;
    }
    snapshot.last_status = status;
    snapshot.connection == ConnectionState::Connected
}

fn publish_operation_result(
    snapshot: &RwLock<RadioSnapshot>,
    radio: Option<&mut Box<dyn Radio>>,
    result: &Result<(), RadioOperationError>,
) -> bool {
    match result {
        Ok(()) => radio.is_some_and(|radio| publish_status(snapshot, radio.get_status())),
        Err(error) => {
            let mut snapshot = snapshot.write().unwrap_or_else(|error| error.into_inner());
            snapshot.connection = ConnectionState::Disconnected;
            snapshot.last_status = Status::disconnected(error.rig);
            snapshot.last_error = None;
            snapshot.last_operation_error = Some(error.clone());
            false
        }
    }
}
