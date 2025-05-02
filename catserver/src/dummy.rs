use crate::freq::{Hz, Khz};
use crate::rig::{Mode, Radio, Slot, Status};

#[derive(Clone)]
pub struct DummyRadio {
    mode: Mode,
    freq_a1: Hz,
    freq_b1: Hz,
    freq_a2: Hz,
    freq_b2: Hz,
    current_rig: u8,
}

impl DummyRadio {
    pub fn new() -> Self {
        Self {
            mode: Mode::USB,
            freq_a1: 0.into(),
            freq_b1: 0.into(),
            freq_a2: 0.into(),
            freq_b2: 0.into(),
            current_rig: 1,
        }
    }
}

impl Radio for DummyRadio {
    fn init(&mut self) {}

    fn get_name(&self) -> &str {
        "dummy"
    }

    fn set_mode(&mut self, mode: Mode) {
        self.mode = mode;
    }

    fn set_rig(&mut self, rig: u8) {
        self.current_rig = rig;
    }

    fn set_frequency(&mut self, slot: Slot, freq: Khz) {
        match (slot, self.current_rig) {
            (Slot::A, 1) => {
                self.freq_a1 = freq.into();
            }
            (Slot::B, 1) => {
                self.freq_b1 = freq.into();
            }
            (Slot::A, 2) => {
                self.freq_a2 = freq.into();
            }
            (Slot::B, 2) => {
                self.freq_b2 = freq.into();
            }
            _ => {
                panic!();
            }
        }
    }

    fn get_status(&mut self) -> Status {
        Status {
            // Currently slot b is not in the status message
            freq: match self.current_rig {
                1 => self.freq_a1,
                2 => self.freq_a2,
                _ => {
                    panic!();
                }
            },
            mode: "SSB".into(),
            status: "connected".into(),
            status_str: "".into(),
            current_rig: self.current_rig,
        }
    }
}
