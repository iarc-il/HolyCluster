// Regression tests for explicit tuning targets and exclusive device ownership.
struct TargetRadio {
    selected: Slot,
    modes: Arc<Mutex<[String; 2]>>,
    events: Arc<Mutex<Vec<&'static str>>>,
    fail_selection: bool,
}

impl Radio for TargetRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        Ok(())
    }
    fn tune_spot(&mut self, mode: Mode, frequency: Freq) -> Result<(), RadioOperationError> {
        let slot = Slot::A;
        self.events.lock().unwrap().push("select A");
        if self.fail_selection {
            return Err(RadioOperationError::new(
                1,
                "select VFO",
                "selection failed",
            ));
        }
        assert_eq!(slot, Slot::A);
        self.selected = slot;
        self.set_frequency(Slot::A, frequency)?;
        self.set_mode(mode)
    }
    fn set_mode(&mut self, _: Mode) -> Result<(), RadioOperationError> {
        self.events.lock().unwrap().push("mode");
        let index = if self.selected == Slot::A { 0 } else { 1 };
        self.modes.lock().unwrap()[index] = "CW".into();
        Ok(())
    }
    fn set_frequency(&mut self, slot: Slot, _: Freq) -> Result<(), RadioOperationError> {
        // The tuning operation must establish A before either write.
        assert_eq!(slot, Slot::A);
        assert_eq!(self.selected, Slot::A);
        self.events.lock().unwrap().push("frequency A");
        Ok(())
    }
    fn get_status(&mut self) -> Result<Status, RadioOperationError> {
        Ok(Status {
            freq: 0,
            status: "connected".into(),
            mode: "CW".into(),
            current_rig: 1,
        })
    }
}

#[tokio::test]
async fn spot_selects_a_before_writes_and_leaves_b_mode_unchanged() {
    check_target(false).await;
}

#[tokio::test]
async fn failed_selection_prevents_both_mode_and_frequency_writes() {
    check_target(true).await;
}

async fn check_target(fail_selection: bool) {
    let config = RadioConfig::platform_default();
    let manager = RadioManager::new(config.clone(), config.effective_backend(false)).unwrap();
    let modes = Arc::new(Mutex::new(["USB".into(), "LSB".into()]));
    let events = Arc::new(Mutex::new(Vec::new()));
    let factory_modes = modes.clone();
    let factory_events = events.clone();
    manager
        .replace(config.clone(), config.effective_backend(false), move || {
            Box::new(TargetRadio {
                selected: Slot::B,
                modes: factory_modes.clone(),
                events: factory_events.clone(),
                fail_selection,
            })
        })
        .await
        .unwrap();
    let result = manager
        .set_mode_and_frequency(Mode::CW, Freq::from_u32_hz(7_050_000))
        .await;
    assert_eq!(result.is_err(), fail_selection);
    if fail_selection {
        assert_eq!(*events.lock().unwrap(), ["select A"]);
        assert_eq!(*modes.lock().unwrap(), ["USB", "LSB"]);
    } else {
        assert_eq!(*events.lock().unwrap(), ["select A", "frequency A", "mode"]);
        assert_eq!(*modes.lock().unwrap(), ["CW", "LSB"]);
    }
    manager.shutdown().await.unwrap();
}

struct ExclusiveRadio {
    port: Arc<Mutex<bool>>,
    owns_port: bool,
    fail: bool,
}

impl Drop for ExclusiveRadio {
    fn drop(&mut self) {
        if self.owns_port {
            *self.port.lock().unwrap() = false;
        }
    }
}
impl Radio for ExclusiveRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        if self.owns_port {
            *self.port.lock().unwrap() = false;
            self.owns_port = false;
        }
        let mut busy = self.port.lock().unwrap();
        if *busy || self.fail {
            self.fail = false;
            return Err(RadioInitError::Backend {
                backend: "exclusive",
                message: if *busy { "port busy" } else { "init failed" }.into(),
            });
        }
        *busy = true;
        self.owns_port = true;
        Ok(())
    }
    fn set_mode(&mut self, _: Mode) -> Result<(), RadioOperationError> {
        Ok(())
    }
    fn set_frequency(&mut self, _: Slot, _: Freq) -> Result<(), RadioOperationError> {
        Ok(())
    }
    fn get_status(&mut self) -> Result<Status, RadioOperationError> {
        Ok(Status {
            freq: 0,
            status: "connected".into(),
            mode: "SSB".into(),
            current_rig: 1,
        })
    }
}

#[tokio::test]
async fn same_port_replacement_releases_old_owner_and_failed_replace_keeps_new_config() {
    let config = RadioConfig::platform_default();
    let manager = RadioManager::new(config.clone(), config.effective_backend(false)).unwrap();
    let port = Arc::new(Mutex::new(false));
    for fail in [false, false, true] {
        let factory_port = port.clone();
        let mut next_config = config.clone();
        if fail {
            next_config.rig = Some(crate::radio_config::RadioRigConfig {
                model_id: "hamlib:1".into(),
                token_values: Default::default(),
            });
        }
        manager
            .replace(
                next_config.clone(),
                next_config.effective_backend(false),
                move || {
                    Box::new(ExclusiveRadio {
                        port: factory_port.clone(),
                        owns_port: false,
                        fail,
                    })
                },
            )
            .await
            .unwrap();
        assert_eq!(manager.snapshot().config, next_config);
        assert_eq!(
            manager.snapshot().connection == ConnectionState::Disconnected,
            fail
        );
        assert_eq!(*port.lock().unwrap(), !fail);
        assert_eq!(
            manager.snapshot().selected,
            next_config.effective_backend(false)
        );
        if fail {
            manager.retry().await.unwrap();
            assert_eq!(manager.snapshot().connection, ConnectionState::Connected);
            assert_eq!(manager.snapshot().config, next_config);
        }
    }
    manager.shutdown().await.unwrap();
}

#[tokio::test]
async fn same_port_test_restores_old_configuration_after_success_and_failure() {
    check_exclusive_test(false, false).await;
    check_exclusive_test(true, false).await;
}

#[tokio::test]
async fn test_restoration_failure_is_visible_and_old_factory_can_retry() {
    check_exclusive_test(false, true).await;
    check_exclusive_test(true, true).await;
}

async fn check_exclusive_test(test_fails: bool, restore_fails: bool) {
    let config = RadioConfig::platform_default();
    let selected = config.effective_backend(false);
    let manager = RadioManager::new(config.clone(), selected.clone()).unwrap();
    let port = Arc::new(Mutex::new(false));
    let attempts = Arc::new(AtomicUsize::new(0));
    let factory_port = port.clone();
    let factory_attempts = attempts.clone();
    manager
        .replace(config.clone(), selected.clone(), move || {
            let attempt = factory_attempts.fetch_add(1, Ordering::SeqCst);
            Box::new(ExclusiveRadio {
                port: factory_port.clone(),
                owns_port: false,
                fail: restore_fails && attempt == 1,
            })
        })
        .await
        .unwrap();
    let test_port = port.clone();
    let result = manager
        .test_connection(move || {
            Box::new(ExclusiveRadio {
                port: test_port.clone(),
                owns_port: false,
                fail: test_fails,
            })
        })
        .await;
    assert_eq!(result.is_err(), test_fails || restore_fails);
    let state = manager.snapshot();
    assert_eq!(state.config, config);
    assert_eq!(state.selected, selected);
    assert_eq!(
        state.connection == ConnectionState::Disconnected,
        restore_fails
    );
    assert_eq!(attempts.load(Ordering::SeqCst), 2);
    if restore_fails {
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("failed to restore active radio")
        );
        assert!(state.last_error.is_some());
        manager.retry().await.unwrap();
        assert_eq!(manager.snapshot().connection, ConnectionState::Connected);
    }
    assert!(*port.lock().unwrap());
    manager.shutdown().await.unwrap();
    assert!(!*port.lock().unwrap());
}
