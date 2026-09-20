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
                    let success = rotator
                        .as_mut()
                        .is_some_and(|rotator| publish_status(&snapshot, rotator.status()).is_ok());
                    next_action = Some(schedule_after_attempt(success, &mut retry_delay));
                } else if let Some(factory) = &factory {
                    let success = replace_from_factory(&snapshot, factory, &mut rotator);
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
                    tracing::info!(selected = %selected, "Replacing rotator backend");
                    {
                        let mut state = snapshot.write().unwrap_or_else(|error| error.into_inner());
                        state.config = config;
                        state.selected = selected.clone();
                        state.last_status.name = selected.to_string();
                    }
                    let success = replace_from_factory(&snapshot, &next_factory, &mut rotator);
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
                    let success = replace_from_factory(&snapshot, active_factory, &mut rotator);
                    retry_delay = Duration::from_secs(1);
                    next_action = Some(schedule_after_attempt(success, &mut retry_delay));
                } else {
                    next_action = None;
                }
                let _ = reply.send(result);
            }
            Command::Retry(reply) => {
                if let Some(factory) = &factory {
                    let success = replace_from_factory(&snapshot, factory, &mut rotator);
                    next_action = Some(schedule_after_attempt(success, &mut retry_delay));
                }
                let _ = reply.send(());
            }
            Command::SetAzimuth(azimuth, reply) => {
                let result = rotator.as_mut().map_or_else(
                    || Err(RotatorError::new("set azimuth", "not configured")),
                    |rotator| rotator.set_azimuth(azimuth),
                );
                if let Err(error) = &result {
                    publish_error(&snapshot, error.clone());
                    next_action = Some(schedule_after_attempt(false, &mut retry_delay));
                } else {
                    let mut state = snapshot.write().unwrap_or_else(|error| error.into_inner());
                    state.target_azimuth = Some(azimuth);
                }
                let _ = reply.send(result);
            }
            Command::Poll(reply) => {
                if let Some(rotator) = &mut rotator {
                    let success = publish_status(&snapshot, rotator.status()).is_ok();
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

fn replace_from_factory(
    snapshot: &RwLock<RotatorSnapshot>,
    factory: &RotatorFactory,
    rotator: &mut Option<Box<dyn Rotator>>,
) -> bool {
    drop(rotator.take());
    let mut candidate = factory();
    let result = candidate.init().and_then(|()| candidate.status());
    let success = publish_status(snapshot, result).is_ok();
    *rotator = Some(candidate);
    success
}

fn publish_status(
    snapshot: &RwLock<RotatorSnapshot>,
    result: Result<crate::rotator::RotatorStatus, RotatorError>,
) -> Result<(), RotatorError> {
    match result {
        Ok(status) if status.status == "connected" => {
            let mut snapshot = snapshot.write().unwrap_or_else(|error| error.into_inner());
            if snapshot.connection != RotatorConnectionState::Connected {
                tracing::info!(selected = %snapshot.selected, "Rotator connected");
            }
            snapshot.connection = RotatorConnectionState::Connected;
            snapshot.last_error = None;
            snapshot.last_status = status;
            Ok(())
        }
        Ok(status) => {
            let error = RotatorError::new("status", status.status.clone());
            let mut snapshot = snapshot.write().unwrap_or_else(|error| error.into_inner());
            if snapshot.connection != RotatorConnectionState::Disconnected
                || snapshot.last_error.as_ref() != Some(&error)
            {
                tracing::warn!(selected = %snapshot.selected, %error, "Rotator disconnected");
            }
            snapshot.connection = RotatorConnectionState::Disconnected;
            snapshot.last_error = Some(error.clone());
            snapshot.last_status = status;
            Err(error)
        }
        Err(error) => {
            publish_error(snapshot, error.clone());
            Err(error)
        }
    }
}

fn publish_error(snapshot: &RwLock<RotatorSnapshot>, error: RotatorError) {
    let mut snapshot = snapshot.write().unwrap_or_else(|error| error.into_inner());
    if snapshot.connection != RotatorConnectionState::Disconnected
        || snapshot.last_error.as_ref() != Some(&error)
    {
        tracing::warn!(selected = %snapshot.selected, %error, "Rotator disconnected");
    }
    snapshot.connection = RotatorConnectionState::Disconnected;
    snapshot.last_error = Some(error);
    snapshot.last_status.status = "disconnected".into();
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
