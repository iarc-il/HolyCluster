use std::{
    sync::{Arc, RwLock, mpsc},
    time::{Duration, Instant},
};

use crate::{
    device_actor::{DeviceFactory, Worker},
    freq::Freq,
    radio_config::{ActiveRadioBackend, RadioBackendKind, RadioConfig},
    radio_manager::{ConnectionState, RadioManagerError, RadioSnapshot},
    rig::{
        Mode, Radio, RadioActorContext, RadioDisconnectContext, RadioInitError,
        RadioInitializationContext, RadioOperationError, Status,
    },
};
use tokio::sync::oneshot;

pub(crate) type RadioFactory = DeviceFactory<Box<dyn Radio>>;

#[derive(Default)]
struct ConnectionTrace {
    outage_started: Option<Instant>,
    failed_attempts: u32,
    initialization_origin: &'static str,
    initialization: Option<RadioInitializationContext>,
    disconnect: Option<RadioDisconnectContext>,
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
        self.initialization = None;
        self.disconnect = None;
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
    Tune(
        Option<Mode>,
        Freq,
        oneshot::Sender<Result<(), RadioOperationError>>,
    ),
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
                connection_trace.initialization_origin = "automatic_retry";
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
        connection_trace.initialization_origin = match &command {
            Command::Replace { .. } => "replacement",
            Command::Test { .. } => "test_restore",
            Command::Retry(_) => "manual_retry",
            _ => "command",
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
                    // Release exclusive device ownership before opening the replacement.
                    drop(radio.take());
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
            Command::Test {
                factory: test_factory,
                reply,
            } => {
                // A test may use the same exclusive serial port as the active radio.
                drop(radio.take());
                let mut candidate = test_factory();
                let mut result = candidate.init();
                drop(candidate);
                if let Some(factory) = &factory {
                    let connected =
                        replace_from_factory(&snapshot, factory, &mut radio, &mut connection_trace);
                    next_action = Some(schedule_after_attempt(connected, &mut retry_delay));
                    if !connected {
                        let state = snapshot.read().unwrap_or_else(|error| error.into_inner());
                        let restoration = state
                            .last_error
                            .as_ref()
                            .map(ToString::to_string)
                            .or_else(|| {
                                state.last_operation_error.as_ref().map(ToString::to_string)
                            })
                            .unwrap_or_else(|| "radio disconnected".into());
                        let test = result
                            .as_ref()
                            .err()
                            .map(|error| format!("Test failed: {error}; "))
                            .unwrap_or_default();
                        result = Err(RadioInitError::Backend {
                            backend: "radio",
                            message: format!("{test}failed to restore active radio: {restoration}"),
                        });
                    }
                }
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
            Command::Tune(mode, frequency, reply) => {
                let actor_context = {
                    let state = snapshot.read().unwrap_or_else(|error| error.into_inner());
                    RadioActorContext {
                        application_connection_state: match state.connection {
                            ConnectionState::Connected => "connected",
                            ConnectionState::Disconnected => "disconnected",
                        },
                        configuration_present: state.config.rig.is_some(),
                        selected_backend: match state.selected {
                            ActiveRadioBackend::Dummy => "dummy",
                            ActiveRadioBackend::Configured(RadioBackendKind::Unconfigured) => {
                                "unconfigured"
                            }
                            ActiveRadioBackend::Configured(RadioBackendKind::Hamlib) => "hamlib",
                            ActiveRadioBackend::Configured(RadioBackendKind::Omnirig) => "omnirig",
                        },
                        model_id: state.config.rig.as_ref().map(|rig| rig.model_id.clone()),
                        backend_object_present: radio.is_some(),
                        initialization_failed: state.last_error.is_some(),
                        initialization: connection_trace.initialization.clone(),
                        disconnect: connection_trace.disconnect.clone(),
                        outage_ms: connection_trace
                            .outage_started
                            .map(|t| t.elapsed().as_millis() as u64),
                        failed_attempts: connection_trace.failed_attempts,
                        retry_delay_ms: retry_delay.as_millis() as u64,
                        next_retry_ms: next_action.map(|t| {
                            t.saturating_duration_since(Instant::now()).as_millis() as u64
                        }),
                        requested_mode: mode.map(|mode| format!("{mode:?}")),
                        requested_frequency_hz: frequency.as_u32_hz(),
                        requested_vfo: "A",
                    }
                };
                let mut mode_warning = None;
                let result = radio
                    .as_mut()
                    .map_or_else(
                        || {
                            Err(RadioOperationError::new(
                                1,
                                "set mode and frequency",
                                "radio unavailable",
                            ))
                        },
                        |radio| {
                            let Some(mode) = mode else {
                                return radio.set_frequency(crate::rig::Slot::A, frequency);
                            };
                            match radio.validate_mode(mode) {
                                Ok(()) => radio.tune_spot(mode, frequency),
                                Err(mut error)
                                    if error.kind
                                        == crate::rig::RadioOperationErrorKind::UnsupportedMode =>
                                {
                                    error.actor_context = Some(Box::new(actor_context.clone()));
                                    mode_warning = Some(error);
                                    radio.set_frequency(crate::rig::Slot::A, frequency)
                                }
                                Err(error) => Err(error),
                            }
                        },
                    )
                    .map_err(|mut error| {
                        // Publishing the failure overwrites the application connection state.
                        error.actor_context = Some(Box::new(actor_context));
                        if let Some(warning) = &mode_warning {
                            let details = error.details.get_or_insert_with(String::new);
                            if !details.is_empty() {
                                details.push('\n');
                            }
                            details.push_str(&warning.to_string());
                        }
                        error
                    });
                let connected = publish_operation_result(
                    &snapshot,
                    radio.as_mut(),
                    &result,
                    &mut connection_trace,
                );
                next_action = factory
                    .as_ref()
                    .map(|_| schedule_after_attempt(connected, &mut retry_delay));
                let _ = reply.send(result.and_then(|()| mode_warning.map_or(Ok(()), Err)));
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
    drop(radio.take());
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
    connection_trace.initialization = Some(RadioInitializationContext {
        origin: connection_trace.initialization_origin,
        outcome: if init.is_ok() { "succeeded" } else { "failed" },
        error: init.as_ref().err().map(ToString::to_string),
        details: init.as_ref().err().and_then(|error| match error {
            RadioInitError::Hamlib { details, .. } => details.clone(),
            _ => None,
        }),
        backend_call: init.as_ref().err().and_then(|error| match error {
            RadioInitError::Com { context, .. } => Some(context.clone()),
            _ => None,
        }),
    });
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
            if connection_trace.disconnect.is_none() {
                connection_trace.disconnect = Some(RadioDisconnectContext {
                    origin: "initialization",
                    error: error.to_string(),
                    backend_call: connection_trace
                        .initialization
                        .as_ref()
                        .and_then(|init| init.backend_call.clone()),
                });
            }
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
            connection_trace.disconnect = None;
            connection_trace.connected(&selected);
            true
        }
        Ok(status) => {
            let error = RadioOperationError::new(1, "read status", status.status.clone());
            publish_status_error(snapshot, status, error, "status_read", connection_trace)
        }
        Err(error) => {
            let status = Status::disconnected(error.rig);
            publish_status_error(snapshot, status, error, "status_read", connection_trace)
        }
    }
}

fn publish_status_error(
    snapshot: &RwLock<RadioSnapshot>,
    status: Status,
    error: RadioOperationError,
    origin: &'static str,
    connection_trace: &mut ConnectionTrace,
) -> bool {
    let mut snapshot = snapshot.write().unwrap_or_else(|error| error.into_inner());
    let selected = snapshot.selected.clone();
    // Keep the first failure until recovery instead of replacing it with "unavailable".
    if snapshot.connection == ConnectionState::Connected || connection_trace.disconnect.is_none() {
        connection_trace.disconnect = Some(RadioDisconnectContext {
            origin,
            error: error.to_string(),
            backend_call: error.backend_context.clone(),
        });
    }
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
            "command",
            connection_trace,
        ),
    }
}
