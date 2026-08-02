use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    thread::ThreadId,
};

use crate::{
    freq::Freq,
    radio_config::RadioConfig,
    radio_manager::{ConnectionState, RadioManager},
    rig::{Mode, Radio, RadioInitError, Slot, Status},
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
    fn set_mode(&mut self, _: Mode) {
        self.record();
    }
    fn set_rig(&mut self, _: u8) {
        self.record();
    }
    fn set_frequency(&mut self, _: Slot, _: Freq) {
        self.record();
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
    fn set_mode(&mut self, _: Mode) {
        self.mode = "CW";
        self.event("mode");
    }
    fn set_rig(&mut self, rig: u8) {
        self.rig = rig;
        self.event("rig");
    }
    fn set_frequency(&mut self, _: Slot, frequency: Freq) {
        self.frequency = frequency.as_u32_hz();
        self.event("frequency");
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
    manager.set_rig(2).await.unwrap();
    manager
        .set_mode_and_frequency(Mode::CW, Freq::from_u32_hz(7_050_000))
        .await
        .unwrap();
    let status = manager.poll_status().await;
    assert_eq!(
        *events.lock().unwrap(),
        ["rig", "status", "mode", "frequency", "status", "status"]
    );
    assert_eq!(
        (status.current_rig, status.freq, status.mode.as_str()),
        (2, 7_050_000, "CW")
    );
    manager.shutdown().await.unwrap();
}
