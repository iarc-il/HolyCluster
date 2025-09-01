use crate::freq::Freq;
use crate::rig::{Mode, Radio, Slot, Status};

#[derive(Clone)]
pub struct DummyRadio {
    mode: Mode,
    freq_a1: Freq,
    freq_b1: Freq,
    freq_a2: Freq,
    freq_b2: Freq,
    current_rig: u8,
}

impl DummyRadio {
    pub fn new() -> Self {
        Self {
            mode: Mode::USB,
            freq_a1: Freq::from_u32_hz(0),
            freq_b1: Freq::from_u32_hz(0),
            freq_a2: Freq::from_u32_hz(0),
            freq_b2: Freq::from_u32_hz(0),
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

    fn set_frequency(&mut self, slot: Slot, freq: Freq) {
        match (slot, self.current_rig) {
            (Slot::A, 1) => {
                self.freq_a1 = freq;
            }
            (Slot::B, 1) => {
                self.freq_b1 = freq;
            }
            (Slot::A, 2) => {
                self.freq_a2 = freq;
            }
            (Slot::B, 2) => {
                self.freq_b2 = freq;
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
                1 => self.freq_a1.as_u32_hz(),
                2 => self.freq_a2.as_u32_hz(),
                _ => {
                    panic!();
                }
            },
            mode: "SSB".into(),
            status: "connected".into(),
            current_rig: self.current_rig,
        }
    }

    fn is_available(&self) -> bool {
        true
    }
}
