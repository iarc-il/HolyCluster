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

#[derive(Default)]
struct ConnectionTrace {
    outage_started: Option<Instant>,
    failed_attempts: u32,
}

impl ConnectionTrace {
    fn disconnected(&mut self, selected: &ActiveRadioBackend, error: &impl std::fmt::Display) {
        self.failed_attempts += 1;
        if self.outage_started.is_some() {
            tracing::debug!(?selected, %error, attempt = self.failed_attempts, "Radio reconnect failed");
            return;
        }
        self.outage_started = Some(Instant::now());
        tracing::warn!(?selected, %error, "Radio disconnected; retrying");
    }

    fn connected(&mut self, selected: &ActiveRadioBackend) {
        let Some(started) = self.outage_started.take() else {
            return;
        };
        tracing::info!(
            ?selected,
            attempts = self.failed_attempts,
            outage_ms = started.elapsed().as_millis(),
            "Radio reconnected"
        );
        self.failed_attempts = 0;
    }

    fn reset(&mut self) {
        self.outage_started = None;
        self.failed_attempts = 0;
    }
}

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
    SetModeAndFrequency(Mode, Freq, oneshot::Sender<Result<(), RadioOperationError>>),
    Poll(oneshot::Sender<Status>),
    Shutdown(oneshot::Sender<()>),
}

pub(crate) fn spawn(
    snapshot: Arc<RwLock<RadioSnapshot>>,
) -> Result<Worker<Command>, RadioManagerError> {
    Worker::spawn("radio-worker", move |receiver| {
        tracing::info!("Radio worker started");
        run(receiver, snapshot);
        tracing::info!("Radio worker stopped");
    })
    .map_err(RadioManagerError::WorkerStart)
}

fn run(receiver: mpsc::Receiver<Command>, snapshot: Arc<RwLock<RadioSnapshot>>) {
    let mut radio: Option<Box<dyn Radio>> = None;
    let mut factory: Option<RadioFactory> = None;
    let mut retry_delay = Duration::from_secs(1);
    let mut next_action: Option<Instant> = None;
    let mut connection_trace = ConnectionTrace::default();
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
                        let status = radio.get_status();
                        let connected = publish_status(&snapshot, status, &mut connection_trace);
                        schedule_after_attempt(connected, &mut retry_delay)
                    });
                } else if radio.is_some() {
                    let connected = reinitialize(&snapshot, &mut radio, &mut connection_trace);
                    next_action = Some(schedule_after_attempt(connected, &mut retry_delay));
                } else if let Some(factory) = &factory {
                    let connected =
                        replace_from_factory(&snapshot, factory, &mut radio, &mut connection_trace);
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
                    connection_trace.reset();
                    let mut candidate = next_factory();
                    let init = candidate.init();
                    let status = init.as_ref().ok().map(|_| candidate.get_status());
                    let connected = publish(
                        &snapshot,
                        config,
                        selected,
                        init,
                        status,
                        &mut connection_trace,
                    );
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
                let connected = if radio.is_some() {
                    Some(reinitialize(&snapshot, &mut radio, &mut connection_trace))
                } else {
                    factory.as_ref().map(|factory| {
                        replace_from_factory(&snapshot, factory, &mut radio, &mut connection_trace)
                    })
                };
                if let Some(connected) = connected {
                    next_action = Some(schedule_after_attempt(connected, &mut retry_delay));
                }
                let _ = reply.send(());
            }
            Command::SetModeAndFrequency(mode, frequency, reply) => {
                let result = radio.as_mut().map_or_else(
                    || {
                        Err(RadioOperationError::new(
                            1,
                            "set mode and frequency",
                            "radio unavailable",
                        ))
                    },
                    |radio| {
                        radio.set_mode(mode)?;
                        radio.set_frequency(Slot::A, frequency)
                    },
                );
                let connected = publish_operation_result(
                    &snapshot,
                    radio.as_mut(),
                    &result,
                    &mut connection_trace,
                );
                next_action = factory
                    .as_ref()
                    .map(|_| schedule_after_attempt(connected, &mut retry_delay));
                let _ = reply.send(result);
            }
            Command::Poll(reply) => {
                if let Some(radio) = radio.as_mut() {
                    let connected =
                        publish_status(&snapshot, radio.get_status(), &mut connection_trace);
                    next_action = Some(schedule_after_attempt(connected, &mut retry_delay));
                }
                let status = snapshot
                    .read()
                    .unwrap_or_else(|error| error.into_inner())
                    .last_status
                    .clone();
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

fn reinitialize(
    snapshot: &RwLock<RadioSnapshot>,
    radio: &mut Option<Box<dyn Radio>>,
    connection_trace: &mut ConnectionTrace,
) -> bool {
    let Some(radio) = radio else {
        return false;
    };
    let init = radio.init();
    let state = snapshot
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .clone();
    let status = init.as_ref().ok().map(|_| radio.get_status());
    publish(
        snapshot,
        state.config,
        state.selected,
        init,
        status,
        connection_trace,
    )
}

fn replace_from_factory(
    snapshot: &RwLock<RadioSnapshot>,
    factory: &RadioFactory,
    radio: &mut Option<Box<dyn Radio>>,
    connection_trace: &mut ConnectionTrace,
) -> bool {
    let mut candidate = factory();
    let init = candidate.init();
    let state = snapshot
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .clone();
    let status = init.as_ref().ok().map(|_| candidate.get_status());
    let connected = publish(
        snapshot,
        state.config,
        state.selected,
        init,
        status,
        connection_trace,
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
    status: Option<Result<Status, RadioOperationError>>,
    connection_trace: &mut ConnectionTrace,
) -> bool {
    {
        let mut snapshot = snapshot.write().unwrap_or_else(|error| error.into_inner());
        snapshot.config = config;
        snapshot.selected = selected.clone();
        snapshot.last_operation_error = None;
    }
    match init {
        Ok(()) => publish_status(
            snapshot,
            status.expect("status is read after successful initialization"),
            connection_trace,
        ),
        Err(error) => {
            let mut snapshot = snapshot.write().unwrap_or_else(|error| error.into_inner());
            snapshot.connection = ConnectionState::Disconnected;
            snapshot.last_error = Some(error.clone());
            snapshot.last_status = Status::disconnected(1);
            drop(snapshot);
            connection_trace.disconnected(&selected, &error);
            false
        }
    }
}

fn publish_status(
    snapshot: &RwLock<RadioSnapshot>,
    result: Result<Status, RadioOperationError>,
    connection_trace: &mut ConnectionTrace,
) -> bool {
    match result {
        Ok(status) if status.status == "connected" => {
            let mut snapshot = snapshot.write().unwrap_or_else(|error| error.into_inner());
            let selected = snapshot.selected.clone();
            snapshot.connection = ConnectionState::Connected;
            snapshot.last_error = None;
            snapshot.last_operation_error = None;
            snapshot.last_status = status;
            drop(snapshot);
            connection_trace.connected(&selected);
            true
        }
        Ok(status) => {
            let error = RadioOperationError::new(1, "read status", status.status.clone());
            publish_status_error(snapshot, status, error, connection_trace)
        }
        Err(error) => {
            let status = Status::disconnected(error.rig);
            publish_status_error(snapshot, status, error, connection_trace)
        }
    }
}

fn publish_status_error(
    snapshot: &RwLock<RadioSnapshot>,
    status: Status,
    error: RadioOperationError,
    connection_trace: &mut ConnectionTrace,
) -> bool {
    let mut snapshot = snapshot.write().unwrap_or_else(|error| error.into_inner());
    let selected = snapshot.selected.clone();
    snapshot.connection = ConnectionState::Disconnected;
    snapshot.last_status = status;
    snapshot.last_error = None;
    snapshot.last_operation_error = Some(error.clone());
    drop(snapshot);
    connection_trace.disconnected(&selected, &error);
    false
}

fn publish_operation_result(
    snapshot: &RwLock<RadioSnapshot>,
    radio: Option<&mut Box<dyn Radio>>,
    result: &Result<(), RadioOperationError>,
    connection_trace: &mut ConnectionTrace,
) -> bool {
    match result {
        Ok(()) => radio
            .is_some_and(|radio| publish_status(snapshot, radio.get_status(), connection_trace)),
        Err(error) => publish_status_error(
            snapshot,
            Status::disconnected(error.rig),
            error.clone(),
            connection_trace,
        ),
    }
}
