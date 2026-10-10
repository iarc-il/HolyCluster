use std::{collections::HashSet, sync::Arc, time::Instant};

#[derive(Clone)]
pub(super) struct AvailabilityTrace {
    channel: &'static str,
    state: Arc<std::sync::Mutex<AvailabilityState>>,
}

#[derive(Default)]
struct AvailabilityState {
    outage_started: Option<Instant>,
    failed_attempts: u64,
    next_connection_id: u64,
    active_connections: HashSet<u64>,
}

pub(super) struct AvailabilityConnection {
    trace: AvailabilityTrace,
    id: Option<u64>,
}

impl AvailabilityTrace {
    pub(super) fn new(channel: &'static str) -> Self {
        Self {
            channel,
            state: Arc::new(std::sync::Mutex::new(AvailabilityState::default())),
        }
    }

    pub(super) fn unavailable(&self, error: &impl std::fmt::Display) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if !state.active_connections.is_empty() {
            tracing::debug!(
                channel = self.channel,
                %error,
                "Upstream connection failed while another connection remains active"
            );
            return;
        }
        state.failed_attempts += 1;
        if state.outage_started.is_some() {
            tracing::debug!(
                channel = self.channel,
                %error,
                attempt = state.failed_attempts,
                "Upstream reconnect failed"
            );
            return;
        }
        state.outage_started = Some(Instant::now());
        tracing::warn!(
            channel = self.channel,
            %error,
            "Upstream connection unavailable; retrying"
        );
    }

    pub(super) fn connection(&self) -> AvailabilityConnection {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let id = state.next_connection_id;
        state.next_connection_id += 1;
        state.active_connections.insert(id);
        drop(state);
        self.available();
        AvailabilityConnection {
            trace: self.clone(),
            id: Some(id),
        }
    }

    pub(super) fn available(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let Some(started) = state.outage_started.take() else {
            return;
        };
        tracing::info!(
            channel = self.channel,
            attempts = state.failed_attempts,
            outage_ms = started.elapsed().as_millis(),
            "Upstream connection restored"
        );
        state.failed_attempts = 0;
    }
}

impl AvailabilityConnection {
    pub(super) fn unavailable(&mut self, error: &impl std::fmt::Display) {
        self.remove();
        self.trace.unavailable(error);
    }

    fn remove(&mut self) {
        let Some(id) = self.id.take() else {
            return;
        };
        self.trace
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .active_connections
            .remove(&id);
    }
}

impl Drop for AvailabilityConnection {
    fn drop(&mut self) {
        self.remove();
    }
}
