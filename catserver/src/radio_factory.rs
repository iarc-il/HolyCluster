use crate::{
    dummy::DummyRadio,
    freq::Freq,
    hamlib_radio::HamlibRadio,
    radio_actor::RadioFactory,
    radio_config::{ActiveRadioBackend, RadioConfig, RadioRigConfig},
    rig::{Mode, Radio, RadioInitError, Slot, Status, UnavailableRadio},
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
            radio(&config.rig1),
            config.rig2.as_ref().map(radio),
        )),
    }
}

fn radio(config: &RadioRigConfig) -> Box<dyn Radio> {
    match config {
        RadioRigConfig::Unconfigured => Box::new(UnavailableRadio::new("unconfigured")),
        RadioRigConfig::Hamlib { hamlib } => Box::new(HamlibRadio::new(hamlib.clone(), None)),
        #[cfg(windows)]
        RadioRigConfig::Omnirig => Box::new(OmnirigRadio::new()),
        #[cfg(not(windows))]
        RadioRigConfig::Omnirig => Box::new(UnavailableRadio::new("omnirig")),
    }
}

struct CompositeRadio {
    rigs: [Option<Box<dyn Radio>>; 2],
    current_rig: u8,
}

impl CompositeRadio {
    fn new(rig1: Box<dyn Radio>, rig2: Option<Box<dyn Radio>>) -> Self {
        Self {
            rigs: [Some(rig1), rig2],
            current_rig: 1,
        }
    }

    fn current(&mut self) -> Option<&mut Box<dyn Radio>> {
        self.rigs
            .get_mut(usize::from(self.current_rig - 1))?
            .as_mut()
    }
}

impl Radio for CompositeRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        // Initialize every configured rig while preserving the first error for reporting.
        let mut first_error = None;
        for (index, rig) in self.rigs.iter_mut().enumerate() {
            let Some(rig) = rig else {
                continue;
            };
            if let Err(error) = rig.init() {
                let error = match error {
                    RadioInitError::Hamlib { error, details, .. } => RadioInitError::Hamlib {
                        rig: (index + 1) as u8,
                        error,
                        details,
                    },
                    error => error,
                };
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
        first_error.map_or(Ok(()), Err)
    }

    fn set_mode(&mut self, mode: Mode) {
        if let Some(rig) = self.current() {
            rig.set_mode(mode);
        }
    }

    fn set_rig(&mut self, rig: u8) {
        if (1..=2).contains(&rig) && self.rigs[usize::from(rig - 1)].is_some() {
            self.current_rig = rig;
        }
    }

    fn set_frequency(&mut self, slot: Slot, freq: Freq) {
        if let Some(rig) = self.current() {
            rig.set_frequency(slot, freq);
        }
    }

    fn get_status(&mut self) -> Status {
        let current_rig = self.current_rig;
        self.current()
            .map(|radio| {
                let mut status = radio.get_status();
                status.current_rig = current_rig;
                status
            })
            .unwrap_or_else(|| Status::disconnected(current_rig))
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeMap,
        sync::{Arc, Mutex},
    };

    use super::{CompositeRadio, factory};
    use crate::{
        freq::Freq,
        radio_config::{HamlibRigConfig, RadioConfig, RadioRigConfig},
        radio_manager::{ConnectionState, RadioManager},
        rig::{Mode, Radio, RadioInitError, Slot, Status},
    };

    struct RecordingRadio {
        events: Arc<Mutex<Vec<String>>>,
    }

    impl Radio for RecordingRadio {
        fn init(&mut self) -> Result<(), RadioInitError> {
            Ok(())
        }

        fn set_mode(&mut self, mode: Mode) {
            self.events.lock().unwrap().push(format!("mode:{mode:?}"));
        }

        fn set_rig(&mut self, rig: u8) {
            self.events.lock().unwrap().push(format!("rig:{rig}"));
        }

        fn set_frequency(&mut self, _: Slot, _: Freq) {}

        fn get_status(&mut self) -> Status {
            Status::disconnected(0)
        }
    }

    #[tokio::test]
    async fn initializes_and_operates_rig2_when_rig1_is_unavailable() {
        let config = RadioConfig {
            rig1: RadioRigConfig::Unconfigured,
            rig2: Some(RadioRigConfig::Hamlib {
                hamlib: HamlibRigConfig {
                    model_id: hamlib::RigModelId::DUMMY.to_string(),
                    token_values: BTreeMap::new(),
                },
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
        assert_eq!(snapshot.connection, ConnectionState::Disconnected);
        assert_eq!(snapshot.last_status, Status::disconnected(1));
        assert_eq!(
            snapshot.last_error,
            Some(RadioInitError::Io {
                backend: "unconfigured",
                kind: std::io::ErrorKind::NotFound,
            })
        );

        manager.set_rig(2).await.unwrap();
        let snapshot = manager.snapshot();
        assert_eq!(snapshot.connection, ConnectionState::Connected);
        assert_eq!(snapshot.last_error, None);
        assert_eq!(snapshot.last_status.current_rig, 2);

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
            (2, 7_100_000, "CW")
        );
        manager.shutdown().await.unwrap();
    }

    #[test]
    fn routes_operations_to_the_selected_rig_backend() {
        let rig1_events = Arc::new(Mutex::new(Vec::new()));
        let rig2_events = Arc::new(Mutex::new(Vec::new()));
        let mut radio = CompositeRadio::new(
            Box::new(RecordingRadio {
                events: Arc::clone(&rig1_events),
            }),
            Some(Box::new(RecordingRadio {
                events: Arc::clone(&rig2_events),
            })),
        );

        radio.set_mode(Mode::USB);
        radio.set_rig(2);
        radio.set_mode(Mode::CW);

        assert_eq!(*rig1_events.lock().unwrap(), vec!["mode:USB".to_owned()]);
        assert_eq!(*rig2_events.lock().unwrap(), vec!["mode:CW".to_owned()]);
        assert_eq!(radio.get_status().current_rig, 2);
    }
}
