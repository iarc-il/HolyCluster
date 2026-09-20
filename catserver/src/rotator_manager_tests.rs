use std::{
    rc::Rc,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    thread::ThreadId,
    time::Duration,
};

use crate::{
    dummy_rotator::DummyRotator,
    rotator::{Rotator, RotatorError, RotatorStatus},
    rotator_manager::{RotatorConnectionState, RotatorManager, RotatorManagerError},
};

struct RecordingRotator {
    events: Arc<Mutex<Vec<(&'static str, ThreadId)>>>,
    marker: Rc<()>,
}

impl RecordingRotator {
    fn record(&self, event: &'static str) {
        self.events
            .lock()
            .unwrap()
            .push((event, std::thread::current().id()));
    }
}

impl Drop for RecordingRotator {
    fn drop(&mut self) {
        self.record("drop");
    }
}

impl Rotator for RecordingRotator {
    fn init(&mut self) -> Result<(), RotatorError> {
        self.record("init");
        Ok(())
    }

    fn name(&self) -> &str {
        let _ = &self.marker;
        "recording"
    }

    fn set_azimuth(&mut self, _: f64) -> Result<(), RotatorError> {
        self.record("set");
        Ok(())
    }

    fn status(&mut self) -> Result<RotatorStatus, RotatorError> {
        self.record("status");
        Ok(RotatorStatus {
            azimuth: 42.0,
            status: "connected".into(),
            name: self.name().into(),
        })
    }
}

struct RetryRotator {
    attempts: Arc<AtomicUsize>,
}

impl Rotator for RetryRotator {
    fn init(&mut self) -> Result<(), RotatorError> {
        if self.attempts.fetch_add(1, Ordering::SeqCst) == 0 {
            Err(RotatorError::new("init", "unavailable"))
        } else {
            Ok(())
        }
    }

    fn name(&self) -> &str {
        "retry"
    }

    fn set_azimuth(&mut self, _: f64) -> Result<(), RotatorError> {
        Ok(())
    }

    fn status(&mut self) -> Result<RotatorStatus, RotatorError> {
        Ok(RotatorStatus {
            azimuth: 0.0,
            status: "connected".into(),
            name: self.name().into(),
        })
    }
}

#[tokio::test]
async fn confines_non_send_backend_lifecycle_to_worker_thread() {
    let manager = RotatorManager::new().unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let factory_events = Arc::clone(&events);
    manager
        .replace("recording", move || {
            Box::new(RecordingRotator {
                events: Arc::clone(&factory_events),
                marker: Rc::new(()),
            })
        })
        .await
        .unwrap();
    manager.set_azimuth(90.0).await.unwrap();
    manager.poll_status().await.unwrap();
    manager.shutdown().await.unwrap();

    let events = events.lock().unwrap();
    assert!(events.iter().any(|(event, _)| *event == "drop"));
    assert!(events.iter().all(|(_, thread)| *thread == events[0].1));
    assert_ne!(events[0].1, std::thread::current().id());
}

#[tokio::test]
async fn publishes_dummy_status_and_target() {
    let manager = RotatorManager::new().unwrap();
    manager
        .replace("dummy_rotator", || Box::new(DummyRotator::new()))
        .await
        .unwrap();
    manager.set_azimuth(90.0).await.unwrap();

    let snapshot = manager.snapshot();
    assert_eq!(snapshot.connection, RotatorConnectionState::Connected);
    assert_eq!(snapshot.target_azimuth, Some(90.0));
    assert_eq!(snapshot.last_status.name, "dummy_rotator");
    manager.shutdown().await.unwrap();
}

#[tokio::test]
async fn reconnects_without_consumers() {
    let manager = RotatorManager::new().unwrap();
    let attempts = Arc::new(AtomicUsize::new(0));
    let factory_attempts = Arc::clone(&attempts);
    manager
        .replace("retry", move || {
            Box::new(RetryRotator {
                attempts: Arc::clone(&factory_attempts),
            })
        })
        .await
        .unwrap();
    assert_eq!(
        manager.snapshot().connection,
        RotatorConnectionState::Disconnected
    );

    tokio::time::timeout(Duration::from_secs(2), async {
        while manager.snapshot().connection != RotatorConnectionState::Connected {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("rotator reconnects automatically");

    assert!(attempts.load(Ordering::SeqCst) >= 2);
    manager.shutdown().await.unwrap();
}

#[tokio::test]
async fn rejects_non_finite_azimuth_before_worker() {
    let manager = RotatorManager::new().unwrap();
    assert!(matches!(
        manager.set_azimuth(f64::NAN).await,
        Err(RotatorManagerError::InvalidAzimuth)
    ));
    manager.shutdown().await.unwrap();
}
