use crate::rig::{Mode, Radio, Slot, Status};

#[derive(Clone)]
pub struct DummyRadio {
    mode: Mode,
    freq_a1: u32,
    freq_b1: u32,
    freq_a2: u32,
    freq_b2: u32,
    current_rig: u8,
}

impl DummyRadio {
    pub fn new() -> Self {
        Self {
            mode: Mode::USB,
            freq_a1: 0,
            freq_b1: 0,
            freq_a2: 0,
            freq_b2: 0,
            current_rig: 1,
        }
    }
}

impl Radio for DummyRadio {
    fn init(&mut self) {
        println!("Initialize radio");
    }

    fn set_mode(&mut self, mode: Mode) {
        println!("Setting mode: {mode:?}");
        self.mode = mode;
    }

    fn set_rig(&mut self, rig: u8) {
        println!("Set rig: {rig:?}");
        self.current_rig = rig;
    }

    fn set_frequency(&mut self, slot: Slot, freq: u32) {
        println!("Setting rig: {slot:?} to freq: {freq}");
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
                1 => self.freq_a1,
                2 => self.freq_a2,
                _ => {
                    panic!();
                }
            },
            status: "connected".into(),
            status_str: "".into(),
            current_rig: self.current_rig,
        }
    }
}
