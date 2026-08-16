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
#[cfg(not(windows))]
use crate::rigctld::RigctldRadio;

pub(crate) fn factory(
    config: RadioConfig,
    selected: ActiveRadioBackend,
    rigctld_endpoint: (String, u16),
) -> RadioFactory {
    std::sync::Arc::new(move || build(&config, &selected, &rigctld_endpoint))
}

fn build(
    config: &RadioConfig,
    selected: &ActiveRadioBackend,
    rigctld_endpoint: &(String, u16),
) -> Box<dyn Radio> {
    let _ = rigctld_endpoint;
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
        #[cfg(not(windows))]
        RadioRigConfig::Rigctld { rigctld } => {
            Box::new(RigctldRadio::new(rigctld.host.clone(), rigctld.port))
        }
        #[cfg(windows)]
        RadioRigConfig::Omnirig => Box::new(OmnirigRadio::new()),
        #[cfg(not(windows))]
        RadioRigConfig::Omnirig => Box::new(UnavailableRadio::new("omnirig")),
        #[cfg(windows)]
        RadioRigConfig::Rigctld { .. } => Box::new(UnavailableRadio::new("rigctld")),
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
        for (index, rig) in self.rigs.iter_mut().flatten().enumerate() {
            rig.init().map_err(|error| match error {
                RadioInitError::Hamlib { error, details, .. } => RadioInitError::Hamlib {
                    rig: (index + 1) as u8,
                    error,
                    details,
                },
                error => error,
            })?;
        }
        Ok(())
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
    use std::sync::{Arc, Mutex};

    use super::CompositeRadio;
    use crate::{
        freq::Freq,
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
