use std::{
    sync::{Arc, Mutex, mpsc},
    thread::ThreadId,
    time::Duration,
};

use crate::{
    device_actor::Worker,
    dummy::DummyRadio,
    radio_actor::Command,
    radio_config::RadioConfig,
    radio_manager::{ConnectionState, RadioManager},
    rig::{Mode, Radio, RadioInitError, RadioOperationError, Slot, Status},
};

struct FailingRadio;

impl Radio for FailingRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        Err(RadioInitError::Io {
            backend: "fake",
            kind: std::io::ErrorKind::ConnectionRefused,
        })
    }
    fn set_mode(&mut self, _: Mode) -> Result<(), RadioOperationError> {
        Ok(())
    }
    fn set_frequency(&mut self, _: Slot, _: crate::freq::Freq) -> Result<(), RadioOperationError> {
        Ok(())
    }
    fn get_status(&mut self) -> Status {
        Status::disconnected(1)
    }
}

struct ThreadRadio {
    events: Arc<Mutex<Vec<ThreadId>>>,
    release: Option<mpsc::Receiver<()>>,
}

impl ThreadRadio {
    fn new(events: Arc<Mutex<Vec<ThreadId>>>, release: Option<mpsc::Receiver<()>>) -> Self {
        events.lock().unwrap().push(std::thread::current().id());
        Self { events, release }
    }
    fn record(&self) {
        self.events
            .lock()
            .unwrap()
            .push(std::thread::current().id());
    }
}

impl Drop for ThreadRadio {
    fn drop(&mut self) {
        self.record();
    }
}

impl Radio for ThreadRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        self.record();
        if let Some(release) = self.release.take() {
            release.recv().unwrap();
        }
        Ok(())
    }
    fn set_mode(&mut self, _: Mode) -> Result<(), RadioOperationError> {
        self.record();
        Ok(())
    }
    fn set_frequency(&mut self, _: Slot, _: crate::freq::Freq) -> Result<(), RadioOperationError> {
        self.record();
        Ok(())
    }
    fn get_status(&mut self) -> Status {
        self.record();
        Status {
            freq: 0,
            status: "connected".into(),
            mode: "SSB".into(),
            current_rig: 1,
        }
    }
}

async fn manager() -> RadioManager {
    let config = RadioConfig::platform_default();
    let manager = RadioManager::new(config.clone(), config.effective_backend(false)).unwrap();
    manager
        .replace(
            config,
            RadioConfig::platform_default().effective_backend(false),
            || Box::new(DummyRadio::new()),
        )
        .await
        .unwrap();
    manager
}

#[tokio::test]
async fn failed_candidate_keeps_selected_backend_observable() {
    let manager = manager().await;
    let config = RadioConfig::platform_default();
    manager
        .replace(config.clone(), config.effective_backend(false), || {
            Box::new(FailingRadio)
        })
        .await
        .unwrap();
    assert_eq!(manager.snapshot().connection, ConnectionState::Disconnected);
    assert!(manager.snapshot().last_error.is_some());
    manager.shutdown().await.unwrap();
}

#[tokio::test]
async fn actor_keeps_native_lifecycle_on_one_thread() {
    let config = RadioConfig::platform_default();
    let events = Arc::new(Mutex::new(Vec::new()));
    let factory_events = Arc::clone(&events);
    let manager = RadioManager::new(config.clone(), config.effective_backend(false)).unwrap();
    manager
        .replace(
            config,
            RadioConfig::platform_default().effective_backend(false),
            move || Box::new(ThreadRadio::new(Arc::clone(&factory_events), None)),
        )
        .await
        .unwrap();
    manager
        .set_mode_and_frequency(Mode::CW, crate::freq::Freq::from_u32_hz(7_000_000))
        .await
        .unwrap();
    manager.shutdown().await.unwrap();
    let events = events.lock().unwrap();
    assert!(events.iter().all(|thread| *thread == events[0]));
}

#[tokio::test]
async fn connection_test_runs_and_drops_candidate_on_worker() {
    let config = RadioConfig::platform_default();
    let manager = RadioManager::new(config.clone(), config.effective_backend(false)).unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let factory_events = Arc::clone(&events);
    manager
        .test_connection(move || Box::new(ThreadRadio::new(Arc::clone(&factory_events), None)))
        .await
        .unwrap();

    assert_eq!(manager.snapshot().connection, ConnectionState::Disconnected);
    {
        let events = events.lock().unwrap();
        assert!(events.iter().all(|thread| *thread == events[0]));
        assert_ne!(events[0], std::thread::current().id());
    }
    manager.shutdown().await.unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn poll_does_not_starve_current_thread_timer_during_blocked_initialization() {
    let manager = Arc::new(manager().await);
    let config = RadioConfig::platform_default();
    let (started_sender, started) = mpsc::channel();
    let (release_sender, release) = mpsc::channel();
    let release = Arc::new(Mutex::new(Some(release)));
    let replacement = Arc::clone(&manager);
    let replace = tokio::spawn(async move {
        replacement
            .replace(config.clone(), config.effective_backend(false), move || {
                started_sender.send(()).unwrap();
                Box::new(ThreadRadio::new(
                    Arc::new(Mutex::new(Vec::new())),
                    release.lock().unwrap().take(),
                ))
            })
            .await
    });
    tokio::task::spawn_blocking(move || started.recv().unwrap())
        .await
        .unwrap();
    let poll = tokio::spawn({
        let manager = Arc::clone(&manager);
        async move { manager.poll_status().await }
    });
    assert!(
        tokio::time::timeout(
            Duration::from_millis(100),
            tokio::time::sleep(Duration::from_millis(50))
        )
        .await
        .is_ok()
    );
    release_sender.send(()).unwrap();
    replace.await.unwrap().unwrap();
    poll.await.unwrap();
    manager.shutdown().await.unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn shutdown_does_not_starve_current_thread_timer() {
    let manager = manager().await;
    let shutdown = tokio::spawn(async move { manager.shutdown().await });
    assert!(
        tokio::time::timeout(
            Duration::from_millis(100),
            tokio::time::sleep(Duration::from_millis(50))
        )
        .await
        .is_ok()
    );
    shutdown.await.unwrap().unwrap();
}

#[test]
fn worker_start_failure_is_typed() {
    let result = Worker::<Command>::spawn_with(|_| {}, |_| Err(std::io::Error::other("denied")));
    assert!(matches!(result, Err(error) if error.kind() == std::io::ErrorKind::Other));
}
