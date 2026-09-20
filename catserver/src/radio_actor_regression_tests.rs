use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
    thread::ThreadId,
};

use crate::{
    freq::Freq,
    radio_config::RadioConfig,
    radio_manager::{ConnectionState, RadioManager},
    rig::{Mode, Radio, RadioInitError, RadioOperationError, Slot, Status},
};

struct RetryRadio {
    attempts: Arc<AtomicUsize>,
    threads: Arc<Mutex<Vec<ThreadId>>>,
}

impl RetryRadio {
    fn record(&self) {
        self.threads
            .lock()
            .unwrap()
            .push(std::thread::current().id());
    }
}

impl Drop for RetryRadio {
    fn drop(&mut self) {
        self.record();
    }
}

impl Radio for RetryRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        self.record();
        if self.attempts.fetch_add(1, Ordering::SeqCst) == 0 {
            return Err(RadioInitError::Io {
                backend: "retry",
                kind: std::io::ErrorKind::ConnectionRefused,
            });
        }
        Ok(())
    }
    fn set_mode(&mut self, _: Mode) -> Result<(), RadioOperationError> {
        self.record();
        Ok(())
    }
    fn set_frequency(&mut self, _: Slot, _: Freq) -> Result<(), RadioOperationError> {
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

struct WriteFailRadio {
    attempts: Arc<AtomicUsize>,
}

impl Radio for WriteFailRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        self.attempts.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    fn set_mode(&mut self, _: Mode) -> Result<(), RadioOperationError> {
        Err(RadioOperationError::new(1, "set mode", "write failed"))
    }

    fn set_frequency(&mut self, _: Slot, _: Freq) -> Result<(), RadioOperationError> {
        Ok(())
    }

    fn get_status(&mut self) -> Status {
        Status {
            freq: 0,
            status: "connected".into(),
            mode: "SSB".into(),
            current_rig: 1,
        }
    }
}

struct RecoveringOrderedRadio {
    attempts: usize,
    started: mpsc::Sender<()>,
    release: Option<mpsc::Receiver<()>>,
    events: Arc<Mutex<Vec<&'static str>>>,
}

impl Radio for RecoveringOrderedRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        self.attempts += 1;
        if self.attempts == 1 {
            return Err(RadioInitError::Io {
                backend: "recovering",
                kind: std::io::ErrorKind::ConnectionRefused,
            });
        }
        self.started.send(()).unwrap();
        self.release.take().unwrap().recv().unwrap();
        Ok(())
    }

    fn set_mode(&mut self, _: Mode) -> Result<(), RadioOperationError> {
        self.events.lock().unwrap().push("mode");
        Ok(())
    }

    fn set_frequency(&mut self, _: Slot, _: Freq) -> Result<(), RadioOperationError> {
        self.events.lock().unwrap().push("frequency");
        Ok(())
    }

    fn get_status(&mut self) -> Status {
        Status {
            freq: 0,
            status: "connected".into(),
            mode: "SSB".into(),
            current_rig: 1,
        }
    }
}

struct OrderedRadio {
    events: Arc<Mutex<Vec<&'static str>>>,
    rig: u8,
    mode: &'static str,
    frequency: u32,
}

impl OrderedRadio {
    fn event(&self, event: &'static str) {
        self.events.lock().unwrap().push(event);
    }
}

impl Radio for OrderedRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        self.event("init");
        Ok(())
    }
    fn set_mode(&mut self, _: Mode) -> Result<(), RadioOperationError> {
        self.mode = "CW";
        self.event("mode");
        Ok(())
    }
    fn set_frequency(&mut self, _: Slot, frequency: Freq) -> Result<(), RadioOperationError> {
        self.frequency = frequency.as_u32_hz();
        self.event("frequency");
        Ok(())
    }
    fn get_status(&mut self) -> Status {
        self.event("status");
        Status {
            freq: self.frequency,
            status: "connected".into(),
            mode: self.mode.into(),
            current_rig: self.rig,
        }
    }
}

#[tokio::test(flavor = "current_thread")]
async fn write_failure_is_visible_and_schedules_recovery_when_reads_succeed() {
    let config = RadioConfig::platform_default();
    let manager = RadioManager::new(config.clone(), config.effective_backend(false)).unwrap();
    let attempts = Arc::new(AtomicUsize::new(0));
    let factory_attempts = Arc::clone(&attempts);
    manager
        .replace(config.clone(), config.effective_backend(false), move || {
            Box::new(WriteFailRadio {
                attempts: Arc::clone(&factory_attempts),
            })
        })
        .await
        .unwrap();

    let error = manager
        .set_mode_and_frequency(Mode::CW, Freq::from_u32_hz(7_100_000))
        .await
        .expect_err("failed write was reported as successful");
    assert!(error.to_string().contains("set mode"));
    let snapshot = manager.snapshot();
    assert_eq!(snapshot.connection, ConnectionState::Disconnected);
    assert_eq!(
        snapshot
            .last_operation_error
            .as_ref()
            .map(|error| error.operation),
        Some("set mode")
    );

    tokio::time::sleep(std::time::Duration::from_millis(1_100)).await;
    assert!(attempts.load(Ordering::SeqCst) >= 2);
    assert_eq!(manager.snapshot().connection, ConnectionState::Connected);
    manager.shutdown().await.unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn retry_reconstructs_failed_selected_backend_on_actor_thread() {
    let config = RadioConfig::platform_default();
    let manager = RadioManager::new(config.clone(), config.effective_backend(false)).unwrap();
    let attempts = Arc::new(AtomicUsize::new(0));
    let threads = Arc::new(Mutex::new(Vec::new()));
    let factory_attempts = Arc::clone(&attempts);
    let factory_threads = Arc::clone(&threads);
    manager
        .replace(config.clone(), config.effective_backend(false), move || {
            Box::new(RetryRadio {
                attempts: Arc::clone(&factory_attempts),
                threads: Arc::clone(&factory_threads),
            })
        })
        .await
        .unwrap();
    assert_eq!(manager.snapshot().connection, ConnectionState::Disconnected);
    manager.retry().await.unwrap();
    assert_eq!(manager.snapshot().connection, ConnectionState::Connected);
    assert_eq!(manager.status().status, "connected");
    manager.shutdown().await.unwrap();
    let threads = threads.lock().unwrap();
    assert!(threads.iter().all(|thread| *thread == threads[0]));
}

#[tokio::test]
async fn retries_failed_backend_without_a_browser_session() {
    let config = RadioConfig::platform_default();
    let manager = RadioManager::new(config.clone(), config.effective_backend(false)).unwrap();
    let attempts = Arc::new(AtomicUsize::new(0));
    let threads = Arc::new(Mutex::new(Vec::new()));
    let factory_attempts = Arc::clone(&attempts);
    let factory_threads = Arc::clone(&threads);
    manager
        .replace(config.clone(), config.effective_backend(false), move || {
            Box::new(RetryRadio {
                attempts: Arc::clone(&factory_attempts),
                threads: Arc::clone(&factory_threads),
            })
        })
        .await
        .unwrap();

    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while manager.snapshot().connection != ConnectionState::Connected {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("radio reconnects automatically");

    assert!(attempts.load(Ordering::SeqCst) >= 2);
    manager.shutdown().await.unwrap();
    let threads = threads.lock().unwrap();
    assert!(threads.iter().all(|thread| *thread == threads[0]));
}

#[tokio::test(flavor = "current_thread")]
async fn commands_queued_during_recovery_remain_fifo() {
    let config = RadioConfig::platform_default();
    let manager =
        Arc::new(RadioManager::new(config.clone(), config.effective_backend(false)).unwrap());
    let events = Arc::new(Mutex::new(Vec::new()));
    let factory_events = Arc::clone(&events);
    let (started_sender, started) = mpsc::channel();
    let (release_sender, release) = mpsc::channel();
    let release = Arc::new(Mutex::new(Some(release)));
    let factory_release = Arc::clone(&release);
    manager
        .replace(config.clone(), config.effective_backend(false), move || {
            Box::new(RecoveringOrderedRadio {
                attempts: 0,
                started: started_sender.clone(),
                release: factory_release.lock().unwrap().take(),
                events: Arc::clone(&factory_events),
            })
        })
        .await
        .unwrap();

    let retry_manager = Arc::clone(&manager);
    let retry = tokio::spawn(async move { retry_manager.retry().await });
    tokio::task::spawn_blocking(move || started.recv().unwrap())
        .await
        .unwrap();
    let frequency_manager = Arc::clone(&manager);
    let set_frequency = tokio::spawn(async move {
        frequency_manager
            .set_mode_and_frequency(Mode::CW, Freq::from_u32_hz(7_050_000))
            .await
    });
    tokio::task::yield_now().await;
    release_sender.send(()).unwrap();

    retry.await.unwrap().unwrap();
    set_frequency.await.unwrap().unwrap();
    assert_eq!(*events.lock().unwrap(), ["mode", "frequency"]);
    manager.shutdown().await.unwrap();
}

#[tokio::test]
async fn commands_reach_backend_in_fifo_order_with_coherent_status() {
    let config = RadioConfig::platform_default();
    let manager = RadioManager::new(config.clone(), config.effective_backend(false)).unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let factory_events = Arc::clone(&events);
    manager
        .replace(
            config,
            RadioConfig::platform_default().effective_backend(false),
            move || {
                Box::new(OrderedRadio {
                    events: Arc::clone(&factory_events),
                    rig: 1,
                    mode: "SSB",
                    frequency: 0,
                })
            },
        )
        .await
        .unwrap();
    events.lock().unwrap().clear();
    manager
        .set_mode_and_frequency(Mode::CW, Freq::from_u32_hz(7_050_000))
        .await
        .unwrap();
    let status = manager.poll_status().await;
    assert_eq!(
        *events.lock().unwrap(),
        ["mode", "frequency", "status", "status"]
    );
    assert_eq!(
        (status.current_rig, status.freq, status.mode.as_str()),
        (1, 7_050_000, "CW")
    );
    manager.shutdown().await.unwrap();
}
