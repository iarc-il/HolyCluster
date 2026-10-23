use std::{
    sync::{Arc, RwLock, mpsc},
    time::{Duration, Instant},
};

use tokio::sync::oneshot;

use crate::{
    device_actor::{DeviceFactory, Worker},
    rotator::{Rotator, RotatorError},
    rotator_config::RotatorConfig,
    rotator_manager::{
        ActiveRotatorBackend, RotatorConnectionState, RotatorManagerError, RotatorSnapshot,
    },
};

pub(crate) type RotatorFactory = DeviceFactory<Box<dyn Rotator>>;

#[derive(Default)]
struct ConnectionTrace {
    outage_started: Option<Instant>,
    failed_attempts: u32,
    initialization: Option<serde_json::Value>,
    disconnect: Option<serde_json::Value>,
}

impl ConnectionTrace {
    fn disconnected(&mut self, selected: &ActiveRotatorBackend, error: &RotatorError) {
        if self.disconnect.is_none() {
            self.disconnect = Some(serde_json::json!({"origin": error.operation, "error": error}));
        }
        self.failed_attempts += 1;
        if self.outage_started.is_some() {
            tracing::debug!(?selected, %error, attempt = self.failed_attempts, "Rotator reconnect failed");
            return;
        }
        self.outage_started = Some(Instant::now());
        tracing::warn!(?selected, %error, "Rotator disconnected; retrying");
    }

    fn connected(&mut self, selected: &ActiveRotatorBackend) {
        let Some(started) = self.outage_started.take() else {
            return;
        };
        tracing::info!(
            ?selected,
            attempts = self.failed_attempts,
            outage_ms = started.elapsed().as_millis(),
            "Rotator reconnected"
        );
        self.failed_attempts = 0;
        self.disconnect = None;
    }

    fn reset(&mut self) {
        self.outage_started = None;
        self.failed_attempts = 0;
        self.initialization = None;
        self.disconnect = None;
    }
}

pub(crate) enum Command {
    Clear {
        config: RotatorConfig,
        persist: bool,
        reply: oneshot::Sender<Result<(), RotatorManagerError>>,
    },
    Replace {
        config: RotatorConfig,
        selected: ActiveRotatorBackend,
        factory: RotatorFactory,
        persist: bool,
        reply: oneshot::Sender<Result<(), RotatorManagerError>>,
    },
    Test {
        config: RotatorConfig,
        selected: ActiveRotatorBackend,
        factory: RotatorFactory,
        reply: oneshot::Sender<Result<(), RotatorError>>,
    },
    Retry(oneshot::Sender<()>),
    SetAzimuth(f64, oneshot::Sender<Result<(), RotatorError>>),
    Stop(oneshot::Sender<Result<(), RotatorError>>),
    Poll(oneshot::Sender<()>),
    Shutdown(oneshot::Sender<()>),
}

pub(crate) fn spawn(
    snapshot: Arc<RwLock<RotatorSnapshot>>,
) -> Result<Worker<Command>, RotatorManagerError> {
    Worker::spawn("rotator-worker", move |receiver| {
        tracing::info!("Rotator worker started");
        run(receiver, snapshot);
        tracing::info!("Rotator worker stopped");
    })
    .map_err(RotatorManagerError::WorkerStart)
}

fn run(receiver: mpsc::Receiver<Command>, snapshot: Arc<RwLock<RotatorSnapshot>>) {
    let mut rotator: Option<Box<dyn Rotator>> = None;
    let mut factory: Option<RotatorFactory> = None;
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
                    == RotatorConnectionState::Connected;
                if connected {
                    let success = rotator.as_mut().is_some_and(|rotator| {
                        publish_status(&snapshot, rotator.status(), &mut connection_trace).is_ok()
                    });
                    next_action = Some(schedule_after_attempt(success, &mut retry_delay));
                } else if let Some(factory) = &factory {
                    let success = replace_from_factory(
                        &snapshot,
                        factory,
                        &mut rotator,
                        &mut connection_trace,
                    );
                    next_action = Some(schedule_after_attempt(success, &mut retry_delay));
                } else {
                    next_action = None;
                }
                continue;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };
        match command {
            Command::Clear {
                config,
                persist,
                reply,
            } => {
                let result = if persist {
                    config.save().map_err(RotatorManagerError::InvalidConfig)
                } else {
                    Ok(())
                };
                if result.is_ok() {
                    drop(rotator.take());
                    factory = None;
                    next_action = None;
                    retry_delay = Duration::from_secs(1);
                    connection_trace.reset();
                    let mut state = snapshot.write().unwrap_or_else(|error| error.into_inner());
                    state.config = config;
                    state.selected = ActiveRotatorBackend::Unconfigured;
                    state.connection = RotatorConnectionState::Disconnected;
                    state.last_error = None;
                    state.last_status = crate::rotator::RotatorStatus::disconnected("unconfigured");
                    state.target_azimuth = None;
                }
                let _ = reply.send(result);
            }
            Command::Replace {
                config,
                selected,
                factory: next_factory,
                persist,
                reply,
            } => {
                let result = if persist {
                    config.save().map_err(RotatorManagerError::InvalidConfig)
                } else {
                    Ok(())
                };
                if result.is_ok() {
                    connection_trace.reset();
                    tracing::info!(selected = %selected, "Replacing rotator backend");
                    {
                        let mut state = snapshot.write().unwrap_or_else(|error| error.into_inner());
                        state.config = config;
                        state.selected = selected.clone();
                        state.last_status.name = selected.to_string();
                    }
                    let success = replace_from_factory(
                        &snapshot,
                        &next_factory,
                        &mut rotator,
                        &mut connection_trace,
                    );
                    factory = Some(next_factory);
                    retry_delay = Duration::from_secs(1);
                    next_action = Some(schedule_after_attempt(success, &mut retry_delay));
                }
                let _ = reply.send(result);
            }
            Command::Test {
                config,
                selected,
                factory: test_factory,
                reply,
            } => {
                let active_is_healthy = {
                    let state = snapshot.read().unwrap_or_else(|error| error.into_inner());
                    state.config == config
                        && state.selected == selected
                        && state.connection == RotatorConnectionState::Connected
                };
                if active_is_healthy {
                    let _ = reply.send(Ok(()));
                    continue;
                }

                {
                    let mut state = snapshot.write().unwrap_or_else(|error| error.into_inner());
                    state.connection = RotatorConnectionState::Disconnected;
                    state.last_status.status = "disconnected".into();
                }
                drop(rotator.take());
                let mut candidate = test_factory();
                let result = candidate.init().and_then(|()| candidate.status()).map(drop);
                drop(candidate);

                if let Some(active_factory) = &factory {
                    let success = replace_from_factory(
                        &snapshot,
                        active_factory,
                        &mut rotator,
                        &mut connection_trace,
                    );
                    retry_delay = Duration::from_secs(1);
                    next_action = Some(schedule_after_attempt(success, &mut retry_delay));
                } else {
                    next_action = None;
                }
                let _ = reply.send(result);
            }
            Command::Retry(reply) => {
                if let Some(factory) = &factory {
                    let success = replace_from_factory(
                        &snapshot,
                        factory,
                        &mut rotator,
                        &mut connection_trace,
                    );
                    next_action = Some(schedule_after_attempt(success, &mut retry_delay));
                }
                let _ = reply.send(());
            }
            Command::SetAzimuth(azimuth, reply) => {
                let context = actor_context(
                    &snapshot,
                    &connection_trace,
                    rotator.is_some(),
                    retry_delay,
                    next_action,
                );
                let result = rotator
                    .as_mut()
                    .map_or_else(
                        || Err(RotatorError::new("set azimuth", "not configured")),
                        |rotator| rotator.set_azimuth(azimuth),
                    )
                    .map_err(|mut error| {
                        error.actor_context = Some(context);
                        error
                    });
                if let Err(error) = &result {
                    publish_error(&snapshot, error.clone(), &mut connection_trace);
                    next_action = Some(schedule_after_attempt(false, &mut retry_delay));
                } else {
                    let mut state = snapshot.write().unwrap_or_else(|error| error.into_inner());
                    state.target_azimuth = Some(azimuth);
                }
                let _ = reply.send(result);
            }
            Command::Stop(reply) => {
                let context = actor_context(
                    &snapshot,
                    &connection_trace,
                    rotator.is_some(),
                    retry_delay,
                    next_action,
                );
                let result = rotator
                    .as_mut()
                    .map_or_else(
                        || Err(RotatorError::new("stop", "not configured")),
                        |rotator| rotator.stop(),
                    )
                    .map_err(|mut error| {
                        error.actor_context = Some(context);
                        error
                    });
                if let Err(error) = &result {
                    publish_error(&snapshot, error.clone(), &mut connection_trace);
                    next_action = Some(schedule_after_attempt(false, &mut retry_delay));
                } else {
                    snapshot
                        .write()
                        .unwrap_or_else(|error| error.into_inner())
                        .target_azimuth = None;
                }
                let _ = reply.send(result);
            }
            Command::Poll(reply) => {
                if let Some(rotator) = &mut rotator {
                    let success =
                        publish_status(&snapshot, rotator.status(), &mut connection_trace).is_ok();
                    next_action = Some(schedule_after_attempt(success, &mut retry_delay));
                }
                let _ = reply.send(());
            }
            Command::Shutdown(reply) => {
                drop(rotator);
                let _ = reply.send(());
                break;
            }
        }
    }
}

fn actor_context(
    snapshot: &RwLock<RotatorSnapshot>,
    trace: &ConnectionTrace,
    backend_object_present: bool,
    retry_delay: Duration,
    next_action: Option<Instant>,
) -> serde_json::Value {
    let state = snapshot.read().unwrap_or_else(|e| e.into_inner());
    serde_json::json!({
        "pre_state": crate::tracing_setup::rotator_state(&state),
        "backend_object_present": backend_object_present,
        "initialization": trace.initialization, "disconnect": trace.disconnect,
        "failed_attempts": trace.failed_attempts,
        "outage_ms": trace.outage_started.map(|t| t.elapsed().as_millis() as u64),
        "retry_delay_ms": retry_delay.as_millis() as u64,
        "next_retry_ms": next_action.map(|t| t.saturating_duration_since(Instant::now()).as_millis() as u64),
    })
}

fn replace_from_factory(
    snapshot: &RwLock<RotatorSnapshot>,
    factory: &RotatorFactory,
    rotator: &mut Option<Box<dyn Rotator>>,
    connection_trace: &mut ConnectionTrace,
) -> bool {
    drop(rotator.take());
    let mut candidate = factory();
    let init = candidate.init();
    connection_trace.initialization = Some(serde_json::json!({
        "outcome": if init.is_ok() { "success" } else { "failure" },
        "error": init.as_ref().err(),
    }));
    let result = init.and_then(|()| candidate.status());
    let success = publish_status(snapshot, result, connection_trace).is_ok();
    *rotator = Some(candidate);
    success
}

fn publish_status(
    snapshot: &RwLock<RotatorSnapshot>,
    result: Result<crate::rotator::RotatorStatus, RotatorError>,
    connection_trace: &mut ConnectionTrace,
) -> Result<(), RotatorError> {
    match result {
        Ok(status) if status.status == "connected" => {
            let mut snapshot = snapshot.write().unwrap_or_else(|error| error.into_inner());
            let selected = snapshot.selected.clone();
            snapshot.connection = RotatorConnectionState::Connected;
            snapshot.last_error = None;
            snapshot.last_status = status;
            drop(snapshot);
            connection_trace.connected(&selected);
            Ok(())
        }
        Ok(status) => {
            let error = RotatorError::new("status", status.status.clone());
            let mut snapshot = snapshot.write().unwrap_or_else(|error| error.into_inner());
            let selected = snapshot.selected.clone();
            snapshot.connection = RotatorConnectionState::Disconnected;
            snapshot.last_error = Some(error.clone());
            snapshot.last_status = status;
            drop(snapshot);
            connection_trace.disconnected(&selected, &error);
            Err(error)
        }
        Err(error) => {
            publish_error(snapshot, error.clone(), connection_trace);
            Err(error)
        }
    }
}

fn publish_error(
    snapshot: &RwLock<RotatorSnapshot>,
    mut error: RotatorError,
    connection_trace: &mut ConnectionTrace,
) {
    // The returned error owns execution context; stored history must not nest snapshots.
    error.actor_context = None;
    let mut snapshot = snapshot.write().unwrap_or_else(|error| error.into_inner());
    let selected = snapshot.selected.clone();
    snapshot.connection = RotatorConnectionState::Disconnected;
    snapshot.last_error = Some(error.clone());
    snapshot.last_status.status = "disconnected".into();
    drop(snapshot);
    connection_trace.disconnected(&selected, &error);
}

fn schedule_after_attempt(success: bool, retry_delay: &mut Duration) -> Instant {
    if success {
        *retry_delay = Duration::from_secs(1);
        Instant::now() + Duration::from_secs(1)
    } else {
        let delay = *retry_delay;
        *retry_delay = (*retry_delay * 2).min(Duration::from_secs(30));
        Instant::now() + delay
    }
}
