use crate::{
    dummy::DummyRadio,
    freq::Freq,
    hamlib_radio::HamlibRadio,
    radio_actor::RadioFactory,
    radio_config::{ActiveRadioBackend, RadioBackendKind, RadioConfig, RadioRigConfig},
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
            radio(&config.rig1, 1),
            config.rig2.as_ref().map(|rig| radio(rig, 2)),
        )),
    }
}

fn radio(config: &RadioRigConfig, rig: u8) -> FixedRigRadio {
    let radio: Box<dyn Radio> = match config.backend {
        RadioBackendKind::Unconfigured => Box::new(UnavailableRadio::new("unconfigured")),
        RadioBackendKind::Hamlib => config
            .hamlib
            .clone()
            .map(|hamlib| Box::new(HamlibRadio::new(hamlib, None)) as Box<dyn Radio>)
            .unwrap_or_else(|| Box::new(UnavailableRadio::new("hamlib"))),
        #[cfg(not(windows))]
        RadioBackendKind::Rigctld => config
            .rigctld
            .as_ref()
            .map(|rigctld| {
                Box::new(RigctldRadio::new(rigctld.host.clone(), rigctld.port)) as Box<dyn Radio>
            })
            .unwrap_or_else(|| Box::new(UnavailableRadio::new("rigctld"))),
        #[cfg(windows)]
        RadioBackendKind::Omnirig => Box::new(OmnirigRadio::new()),
        #[cfg(not(windows))]
        RadioBackendKind::Omnirig => Box::new(UnavailableRadio::new("omnirig")),
        #[cfg(windows)]
        RadioBackendKind::Rigctld => Box::new(UnavailableRadio::new("rigctld")),
    };
    FixedRigRadio { rig, radio }
}

struct CompositeRadio {
    rigs: [Option<FixedRigRadio>; 2],
    current_rig: u8,
}

impl CompositeRadio {
    fn new(rig1: FixedRigRadio, rig2: Option<FixedRigRadio>) -> Self {
        Self {
            rigs: [Some(rig1), rig2],
            current_rig: 1,
        }
    }

    fn current(&mut self) -> Option<&mut FixedRigRadio> {
        self.rigs
            .get_mut(usize::from(self.current_rig - 1))?
            .as_mut()
    }
}

impl Radio for CompositeRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        for rig in self.rigs.iter_mut().flatten() {
            rig.init()?;
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
            .map(Radio::get_status)
            .unwrap_or_else(|| Status::disconnected(current_rig))
    }
}

struct FixedRigRadio {
    rig: u8,
    radio: Box<dyn Radio>,
}

impl Radio for FixedRigRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        self.radio.init().map_err(|error| match error {
            RadioInitError::Hamlib { error, .. } => RadioInitError::Hamlib {
                rig: self.rig,
                error,
            },
            error => error,
        })
    }

    fn set_mode(&mut self, mode: Mode) {
        self.radio.set_rig(self.rig);
        self.radio.set_mode(mode);
    }

    fn set_rig(&mut self, _: u8) {}

    fn set_frequency(&mut self, slot: Slot, freq: Freq) {
        self.radio.set_rig(self.rig);
        self.radio.set_frequency(slot, freq);
    }

    fn get_status(&mut self) -> Status {
        self.radio.set_rig(self.rig);
        let mut status = self.radio.get_status();
        status.current_rig = self.rig;
        status
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::{CompositeRadio, FixedRigRadio};
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
            FixedRigRadio {
                rig: 1,
                radio: Box::new(RecordingRadio {
                    events: Arc::clone(&rig1_events),
                }),
            },
            Some(FixedRigRadio {
                rig: 2,
                radio: Box::new(RecordingRadio {
                    events: Arc::clone(&rig2_events),
                }),
            }),
        );

        radio.set_mode(Mode::USB);
        radio.set_rig(2);
        radio.set_mode(Mode::CW);

        assert_eq!(
            *rig1_events.lock().unwrap(),
            vec!["rig:1".to_owned(), "mode:USB".to_owned()]
        );
        assert_eq!(
            *rig2_events.lock().unwrap(),
            vec!["rig:2".to_owned(), "mode:CW".to_owned()]
        );
        assert_eq!(radio.get_status().current_rig, 2);
    }
}
