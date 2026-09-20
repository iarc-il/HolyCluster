use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use crate::{
    dummy::DummyRadio,
    freq::Freq,
    hamlib_radio::HamlibRadio,
    radio_actor::RadioFactory,
    radio_config::{ActiveRadioBackend, RadioConfig, RadioRigConfig, ResolvedRadioModel},
    rig::{Mode, Radio, RadioInitError, RadioOperationError, Slot, Status, UnavailableRadio},
};

#[cfg(windows)]
use crate::omnirig::OmnirigRadio;

pub(crate) fn factory(config: RadioConfig, selected: ActiveRadioBackend) -> RadioFactory {
    std::sync::Arc::new(move || build(&config, &selected))
}

fn build(config: &RadioConfig, selected: &ActiveRadioBackend) -> Box<dyn Radio> {
    match selected {
        ActiveRadioBackend::Dummy => Box::new(DummyRadio::new()),
        ActiveRadioBackend::Configured(_) => Box::new(CompositeRadio::new(
            child_factory(config.rig.as_ref()),
            None,
        )),
    }
}

fn child_factory(config: Option<&RadioRigConfig>) -> RadioFactory {
    let config = config.cloned();
    Arc::new(move || radio(config.as_ref()))
}

fn radio(config: Option<&RadioRigConfig>) -> Box<dyn Radio> {
    let Some(config) = config else {
        return Box::new(UnavailableRadio::new("unconfigured"));
    };
    match crate::radio_config::resolve_model_id(&config.model_id) {
        Ok(ResolvedRadioModel::Hamlib(_)) => match config.hamlib_config() {
            Some(hamlib) => Box::new(HamlibRadio::new(hamlib, None)),
            None => Box::new(UnavailableRadio::new("hamlib")),
        },
        Ok(ResolvedRadioModel::Omnirig(_)) => {
            #[cfg(windows)]
            {
                Box::new(OmnirigRadio::new())
            }
            #[cfg(not(windows))]
            {
                Box::new(UnavailableRadio::new("omnirig"))
            }
        }
        Err(_) => Box::new(UnavailableRadio::new("unconfigured")),
    }
}

struct RadioSlot {
    factory: RadioFactory,
    radio: Option<Box<dyn Radio>>,
    status: Status,
    last_error: Option<RadioInitError>,
    retry_delay: Duration,
    next_retry: Option<Instant>,
}

impl RadioSlot {
    fn new(rig: u8, factory: RadioFactory) -> Self {
        Self {
            factory,
            radio: None,
            status: Status::disconnected(rig),
            last_error: None,
            retry_delay: Duration::from_secs(1),
            next_retry: None,
        }
    }

    fn initialize(&mut self, rig: u8) {
        if self.radio.is_some()
            || self
                .next_retry
                .is_some_and(|deadline| deadline > Instant::now())
        {
            return;
        }
        let mut candidate = (self.factory)();
        match candidate.init() {
            Ok(()) => {
                let mut status = candidate.get_status();
                status.current_rig = rig;
                if status.status == "connected" {
                    self.radio = Some(candidate);
                    self.status = status;
                    self.last_error = None;
                    self.retry_delay = Duration::from_secs(1);
                    self.next_retry = None;
                    return;
                }
                self.status = status;
                self.last_error = Some(RadioInitError::Io {
                    backend: "radio",
                    kind: std::io::ErrorKind::NotConnected,
                });
            }
            Err(error) => self.last_error = Some(with_rig(error, rig)),
        }
        self.schedule_retry();
    }

    fn poll(&mut self, rig: u8) {
        if let Some(radio) = &mut self.radio {
            let mut status = radio.get_status();
            status.current_rig = rig;
            self.status = status;
            if self.status.status != "connected" {
                self.radio = None;
                self.last_error = Some(RadioInitError::Io {
                    backend: "radio",
                    kind: std::io::ErrorKind::NotConnected,
                });
                self.schedule_retry();
            }
        } else {
            self.initialize(rig);
        }
    }

    fn fail_operation(&mut self) {
        self.radio = None;
        self.schedule_retry();
    }

    fn schedule_retry(&mut self) {
        self.next_retry = Some(Instant::now() + self.retry_delay);
        self.retry_delay = (self.retry_delay * 2).min(Duration::from_secs(30));
    }
}

struct CompositeRadio {
    rigs: [Option<RadioSlot>; 2],
    current_rig: u8,
}

impl CompositeRadio {
    fn new(rig1: RadioFactory, rig2: Option<RadioFactory>) -> Self {
        Self {
            rigs: [
                Some(RadioSlot::new(1, rig1)),
                rig2.map(|factory| RadioSlot::new(2, factory)),
            ],
            current_rig: 1,
        }
    }

    fn current(&mut self) -> Option<&mut RadioSlot> {
        self.rigs
            .get_mut(usize::from(self.current_rig - 1))?
            .as_mut()
    }
}

fn with_rig(error: RadioInitError, rig: u8) -> RadioInitError {
    match error {
        RadioInitError::Hamlib { error, details, .. } => RadioInitError::Hamlib {
            rig,
            error,
            details,
        },
        error => error,
    }
}

impl Radio for CompositeRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        for (index, slot) in self.rigs.iter_mut().enumerate() {
            if let Some(slot) = slot {
                slot.initialize((index + 1) as u8);
            }
        }
        let current_rig = self.current_rig;
        let slot = self.current().ok_or(RadioInitError::Io {
            backend: "unconfigured",
            kind: std::io::ErrorKind::NotFound,
        })?;
        if slot.status.status == "connected" {
            Ok(())
        } else {
            Err(slot.last_error.clone().unwrap_or(RadioInitError::Io {
                backend: "radio",
                kind: std::io::ErrorKind::NotConnected,
            }))
            .map_err(|error| with_rig(error, current_rig))
        }
    }

    fn set_mode(&mut self, mode: Mode) -> Result<(), RadioOperationError> {
        let current_rig = self.current_rig;
        let slot = self
            .current()
            .ok_or_else(|| RadioOperationError::new(current_rig, "set mode", "rig unavailable"))?;
        let result = slot
            .radio
            .as_mut()
            .ok_or_else(|| RadioOperationError::new(current_rig, "set mode", "rig unavailable"))?
            .set_mode(mode)
            .map_err(|error| error.with_rig(current_rig));
        if result.is_err() {
            slot.fail_operation();
        }
        result
    }

    fn set_rig(&mut self, rig: u8) -> Result<(), RadioOperationError> {
        if !(1..=2).contains(&rig) || self.rigs[usize::from(rig - 1)].is_none() {
            return Err(RadioOperationError::new(
                rig,
                "select rig",
                "rig unavailable",
            ));
        }
        self.current_rig = rig;
        Ok(())
    }

    fn set_frequency(&mut self, slot: Slot, freq: Freq) -> Result<(), RadioOperationError> {
        let current_rig = self.current_rig;
        let radio_slot = self.current().ok_or_else(|| {
            RadioOperationError::new(current_rig, "set frequency", "rig unavailable")
        })?;
        let result = radio_slot
            .radio
            .as_mut()
            .ok_or_else(|| {
                RadioOperationError::new(current_rig, "set frequency", "rig unavailable")
            })?
            .set_frequency(slot, freq)
            .map_err(|error| error.with_rig(current_rig));
        if result.is_err() {
            radio_slot.fail_operation();
        }
        result
    }

    fn get_status(&mut self) -> Status {
        for (index, slot) in self.rigs.iter_mut().enumerate() {
            if let Some(slot) = slot {
                slot.poll((index + 1) as u8);
            }
        }
        let current_rig = self.current_rig;
        self.current()
            .map(|slot| slot.status.clone())
            .unwrap_or_else(|| Status::disconnected(current_rig))
    }

    fn initialization_errors(&self) -> [Option<RadioInitError>; 2] {
        std::array::from_fn(|index| {
            self.rigs[index]
                .as_ref()
                .and_then(|slot| slot.last_error.clone())
        })
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        sync::{
            Arc, Mutex,
            atomic::{AtomicBool, AtomicUsize, Ordering},
        },
        time::Duration,
    };

    use super::{CompositeRadio, factory};
    use crate::{
        freq::Freq,
        radio_config::{RadioConfig, RadioRigConfig},
        radio_manager::{ConnectionState, RadioManager},
        rig::{Mode, Radio, RadioInitError, RadioOperationError, Slot, Status},
    };

    struct ControllableRadio {
        rig: u8,
        healthy: Arc<AtomicBool>,
        initializations: Arc<AtomicUsize>,
        modes: Arc<Mutex<Vec<u8>>>,
    }

    impl Radio for ControllableRadio {
        fn init(&mut self) -> Result<(), RadioInitError> {
            self.initializations.fetch_add(1, Ordering::SeqCst);
            if self.healthy.load(Ordering::SeqCst) {
                Ok(())
            } else {
                Err(RadioInitError::Io {
                    backend: "test",
                    kind: std::io::ErrorKind::ConnectionRefused,
                })
            }
        }

        fn set_mode(&mut self, _: Mode) -> Result<(), RadioOperationError> {
            self.modes.lock().unwrap().push(self.rig);
            Ok(())
        }

        fn set_rig(&mut self, _: u8) -> Result<(), RadioOperationError> {
            Ok(())
        }

        fn set_frequency(&mut self, _: Slot, _: Freq) -> Result<(), RadioOperationError> {
            Ok(())
        }

        fn get_status(&mut self) -> Status {
            if self.healthy.load(Ordering::SeqCst) {
                Status {
                    freq: 0,
                    status: "connected".into(),
                    mode: "SSB".into(),
                    current_rig: self.rig,
                }
            } else {
                Status::disconnected(self.rig)
            }
        }
    }

    fn controllable_factory(
        rig: u8,
        healthy: Arc<AtomicBool>,
        initializations: Arc<AtomicUsize>,
        modes: Arc<Mutex<Vec<u8>>>,
    ) -> super::RadioFactory {
        Arc::new(move || {
            Box::new(ControllableRadio {
                rig,
                healthy: Arc::clone(&healthy),
                initializations: Arc::clone(&initializations),
                modes: Arc::clone(&modes),
            })
        })
    }

    struct RecordingRadio {
        events: Arc<Mutex<Vec<String>>>,
    }

    impl Radio for RecordingRadio {
        fn init(&mut self) -> Result<(), RadioInitError> {
            Ok(())
        }

        fn set_mode(&mut self, mode: Mode) -> Result<(), RadioOperationError> {
            self.events.lock().unwrap().push(format!("mode:{mode:?}"));
            Ok(())
        }

        fn set_rig(&mut self, rig: u8) -> Result<(), RadioOperationError> {
            self.events.lock().unwrap().push(format!("rig:{rig}"));
            Ok(())
        }

        fn set_frequency(&mut self, _: Slot, _: Freq) -> Result<(), RadioOperationError> {
            Ok(())
        }

        fn get_status(&mut self) -> Status {
            Status {
                freq: 0,
                status: "connected".into(),
                mode: "SSB".into(),
                current_rig: 0,
            }
        }
    }

    #[tokio::test]
    async fn initializes_and_operates_configured_single_hamlib_rig() {
        let config = RadioConfig {
            rig: Some(RadioRigConfig {
                model_id: "hamlib:1".into(),
                token_values: BTreeMap::new(),
            }),
        };
        let selected = config.effective_backend(false);
        let manager = RadioManager::new(config.clone(), selected.clone()).unwrap();
        let radio_factory = factory(config.clone(), selected.clone());

        manager
            .replace(config, selected, move || radio_factory())
            .await
            .unwrap();

        let snapshot = manager.snapshot();
        assert_eq!(snapshot.connection, ConnectionState::Connected);
        assert_eq!(snapshot.last_error, None);
        assert_eq!(snapshot.last_status.current_rig, 1);

        manager
            .set_mode_and_frequency(Mode::CW, Freq::from_u32_hz(7_100_000))
            .await
            .unwrap();
        assert_eq!(
            (
                manager.status().current_rig,
                manager.status().freq,
                manager.status().mode.as_str()
            ),
            (1, 7_100_000, "CW")
        );
        manager.shutdown().await.unwrap();
    }

    #[test]
    fn failing_secondary_does_not_reinitialize_primary() {
        let rig1_health = Arc::new(AtomicBool::new(true));
        let rig2_health = Arc::new(AtomicBool::new(false));
        let rig1_initializations = Arc::new(AtomicUsize::new(0));
        let rig2_initializations = Arc::new(AtomicUsize::new(0));
        let modes = Arc::new(Mutex::new(Vec::new()));
        let mut radio = CompositeRadio::new(
            controllable_factory(
                1,
                rig1_health,
                Arc::clone(&rig1_initializations),
                Arc::clone(&modes),
            ),
            Some(controllable_factory(
                2,
                Arc::clone(&rig2_health),
                Arc::clone(&rig2_initializations),
                modes,
            )),
        );

        radio.init().unwrap();
        assert_eq!(radio.get_status().current_rig, 1);
        std::thread::sleep(Duration::from_millis(1_050));
        radio.get_status();

        assert_eq!(rig1_initializations.load(Ordering::SeqCst), 1);
        assert!(rig2_initializations.load(Ordering::SeqCst) >= 2);
        assert!(radio.initialization_errors()[1].is_some());
    }

    #[test]
    fn selected_rig_survives_independent_recovery_and_receives_next_command() {
        let rig1_initializations = Arc::new(AtomicUsize::new(0));
        let rig2_initializations = Arc::new(AtomicUsize::new(0));
        let rig2_health = Arc::new(AtomicBool::new(true));
        let modes = Arc::new(Mutex::new(Vec::new()));
        let mut radio = CompositeRadio::new(
            controllable_factory(
                1,
                Arc::new(AtomicBool::new(true)),
                Arc::clone(&rig1_initializations),
                Arc::clone(&modes),
            ),
            Some(controllable_factory(
                2,
                Arc::clone(&rig2_health),
                Arc::clone(&rig2_initializations),
                Arc::clone(&modes),
            )),
        );
        radio.init().unwrap();
        radio.set_rig(2).unwrap();
        rig2_health.store(false, Ordering::SeqCst);
        assert_eq!(radio.get_status().current_rig, 2);
        rig2_health.store(true, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(1_050));
        radio.init().unwrap();
        radio.set_mode(Mode::CW).unwrap();

        assert_eq!(radio.get_status().current_rig, 2);
        assert_eq!(*modes.lock().unwrap(), vec![2]);
        assert_eq!(rig1_initializations.load(Ordering::SeqCst), 1);
        assert!(rig2_initializations.load(Ordering::SeqCst) >= 2);
    }

    #[test]
    fn routes_operations_to_the_selected_rig_backend() {
        let rig1_events = Arc::new(Mutex::new(Vec::new()));
        let rig2_events = Arc::new(Mutex::new(Vec::new()));
        let rig1_factory = {
            let events = Arc::clone(&rig1_events);
            Arc::new(move || {
                Box::new(RecordingRadio {
                    events: Arc::clone(&events),
                }) as Box<dyn Radio>
            })
        };
        let rig2_factory = {
            let events = Arc::clone(&rig2_events);
            Arc::new(move || {
                Box::new(RecordingRadio {
                    events: Arc::clone(&events),
                }) as Box<dyn Radio>
            })
        };
        let mut radio = CompositeRadio::new(rig1_factory, Some(rig2_factory));
        radio.init().unwrap();

        radio.set_mode(Mode::USB).unwrap();
        radio.set_rig(2).unwrap();
        radio.set_mode(Mode::CW).unwrap();

        assert_eq!(*rig1_events.lock().unwrap(), vec!["mode:USB".to_owned()]);
        assert_eq!(*rig2_events.lock().unwrap(), vec!["mode:CW".to_owned()]);
        assert_eq!(radio.get_status().current_rig, 2);
    }
}
