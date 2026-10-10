use std::{
    collections::BTreeMap,
    rc::Rc,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread::ThreadId,
    time::Duration,
};

use crate::{
    dummy_rotator::DummyRotator,
    hamlib_device_config::HamlibDeviceConfig,
    rotator::{Rotator, RotatorError, RotatorStatus},
    rotator_config::RotatorConfig,
    rotator_manager::{
        ActiveRotatorBackend, RotatorConnectionState, RotatorManager, RotatorManagerError,
    },
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

struct ExclusiveRotator {
    active: Arc<AtomicUsize>,
    overlap: Arc<AtomicBool>,
}

impl ExclusiveRotator {
    fn create(active: Arc<AtomicUsize>, overlap: Arc<AtomicBool>) -> Box<dyn Rotator> {
        if active.fetch_add(1, Ordering::SeqCst) != 0 {
            overlap.store(true, Ordering::SeqCst);
        }
        Box::new(Self { active, overlap })
    }
}

impl Drop for ExclusiveRotator {
    fn drop(&mut self) {
        self.active.fetch_sub(1, Ordering::SeqCst);
    }
}

impl Rotator for ExclusiveRotator {
    fn init(&mut self) -> Result<(), RotatorError> {
        Ok(())
    }

    fn name(&self) -> &str {
        let _ = &self.overlap;
        "exclusive"
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

fn configured_rotator() -> (RotatorConfig, ActiveRotatorBackend) {
    let hamlib = HamlibDeviceConfig {
        model_id: hamlib::RotatorModelId::DUMMY.to_string(),
        token_values: BTreeMap::new(),
    };
    (
        RotatorConfig::Hamlib {
            hamlib: hamlib.clone(),
        },
        ActiveRotatorBackend::Configured(hamlib),
    )
}

#[tokio::test]
async fn confines_non_send_backend_lifecycle_to_worker_thread() {
    let manager = RotatorManager::new(RotatorConfig::unconfigured()).unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let factory_events = Arc::clone(&events);
    manager
        .replace(
            RotatorConfig::unconfigured(),
            ActiveRotatorBackend::DummyOverride,
            move || {
                Box::new(RecordingRotator {
                    events: Arc::clone(&factory_events),
                    marker: Rc::new(()),
                })
            },
        )
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
    let manager = RotatorManager::new(RotatorConfig::unconfigured()).unwrap();
    manager
        .replace(
            RotatorConfig::unconfigured(),
            ActiveRotatorBackend::DummyOverride,
            || Box::new(DummyRotator::new()),
        )
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
async fn cached_consumers_do_not_multiply_hardware_polls() {
    let manager = RotatorManager::new(RotatorConfig::unconfigured()).unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let factory_events = Arc::clone(&events);
    manager
        .replace(
            RotatorConfig::unconfigured(),
            ActiveRotatorBackend::DummyOverride,
            move || {
                Box::new(RecordingRotator {
                    events: Arc::clone(&factory_events),
                    marker: Rc::new(()),
                })
            },
        )
        .await
        .unwrap();
    let polls_before = events
        .lock()
        .unwrap()
        .iter()
        .filter(|(event, _)| *event == "status")
        .count();

    for _ in 0..100 {
        let _ = manager.status();
    }

    let polls_after = events
        .lock()
        .unwrap()
        .iter()
        .filter(|(event, _)| *event == "status")
        .count();
    assert_eq!(polls_after, polls_before);
    manager.shutdown().await.unwrap();
}

#[tokio::test]
async fn reconnects_without_consumers() {
    let manager = RotatorManager::new(RotatorConfig::unconfigured()).unwrap();
    let attempts = Arc::new(AtomicUsize::new(0));
    let factory_attempts = Arc::clone(&attempts);
    manager
        .replace(
            RotatorConfig::unconfigured(),
            ActiveRotatorBackend::DummyOverride,
            move || {
                Box::new(RetryRotator {
                    attempts: Arc::clone(&factory_attempts),
                })
            },
        )
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
async fn same_healthy_configuration_test_reuses_active_rotator() {
    let manager = RotatorManager::new(RotatorConfig::unconfigured()).unwrap();
    let (config, selected) = configured_rotator();
    let active = Arc::new(AtomicUsize::new(0));
    let overlap = Arc::new(AtomicBool::new(false));
    let active_count = Arc::clone(&active);
    let active_overlap = Arc::clone(&overlap);
    manager
        .replace(config.clone(), selected.clone(), move || {
            ExclusiveRotator::create(Arc::clone(&active_count), Arc::clone(&active_overlap))
        })
        .await
        .unwrap();
    let test_creations = Arc::new(AtomicUsize::new(0));
    let creations = Arc::clone(&test_creations);
    manager
        .test_connection(config, selected, move || {
            creations.fetch_add(1, Ordering::SeqCst);
            Box::new(DummyRotator::new())
        })
        .await
        .unwrap();

    assert_eq!(test_creations.load(Ordering::SeqCst), 0);
    assert_eq!(active.load(Ordering::SeqCst), 1);
    assert!(!overlap.load(Ordering::SeqCst));
    manager.shutdown().await.unwrap();
}

#[tokio::test]
async fn testing_and_replacement_never_overlap_exclusive_instances() {
    let manager = RotatorManager::new(RotatorConfig::unconfigured()).unwrap();
    let (config, configured) = configured_rotator();
    let active = Arc::new(AtomicUsize::new(0));
    let overlap = Arc::new(AtomicBool::new(false));
    let active_count = Arc::clone(&active);
    let active_overlap = Arc::clone(&overlap);
    manager
        .replace(
            config.clone(),
            ActiveRotatorBackend::DummyOverride,
            move || {
                ExclusiveRotator::create(Arc::clone(&active_count), Arc::clone(&active_overlap))
            },
        )
        .await
        .unwrap();

    let test_active = Arc::clone(&active);
    let test_overlap = Arc::clone(&overlap);
    manager
        .test_connection(config.clone(), configured.clone(), move || {
            ExclusiveRotator::create(Arc::clone(&test_active), Arc::clone(&test_overlap))
        })
        .await
        .unwrap();
    assert_eq!(
        manager.snapshot().selected,
        ActiveRotatorBackend::DummyOverride
    );
    assert_eq!(active.load(Ordering::SeqCst), 1);
    assert!(!overlap.load(Ordering::SeqCst));

    let replacement_active = Arc::clone(&active);
    let replacement_overlap = Arc::clone(&overlap);
    manager
        .replace(config, configured, move || {
            ExclusiveRotator::create(
                Arc::clone(&replacement_active),
                Arc::clone(&replacement_overlap),
            )
        })
        .await
        .unwrap();
    assert_eq!(active.load(Ordering::SeqCst), 1);
    assert!(!overlap.load(Ordering::SeqCst));
    manager.shutdown().await.unwrap();
    assert_eq!(active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn rejects_non_finite_azimuth_before_worker() {
    let manager = RotatorManager::new(RotatorConfig::unconfigured()).unwrap();
    assert!(matches!(
        manager.set_azimuth(f64::NAN).await,
        Err(RotatorManagerError::InvalidAzimuth)
    ));
    manager.shutdown().await.unwrap();
}
