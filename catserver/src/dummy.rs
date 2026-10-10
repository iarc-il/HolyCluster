use crate::freq::Freq;
use crate::rig::{Mode, Radio, RadioInitError, RadioOperationError, Slot, Status};

#[derive(Clone)]
pub struct DummyRadio {
    mode: Mode,
    freq_a: Freq,
    freq_b: Freq,
}

impl DummyRadio {
    pub fn new() -> Self {
        Self {
            mode: Mode::USB,
            freq_a: Freq::from_u32_hz(0),
            freq_b: Freq::from_u32_hz(0),
        }
    }
}

impl Radio for DummyRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        Ok(())
    }

    fn set_mode(&mut self, mode: Mode) -> Result<(), RadioOperationError> {
        self.mode = mode;
        Ok(())
    }

    fn set_frequency(&mut self, slot: Slot, freq: Freq) -> Result<(), RadioOperationError> {
        match slot {
            Slot::A => {
                self.freq_a = freq;
            }
            Slot::B => {
                self.freq_b = freq;
            }
        }
        Ok(())
    }

    fn get_status(&mut self) -> Result<Status, RadioOperationError> {
        Ok(Status {
            freq: self.freq_a.as_u32_hz(),
            mode: "SSB".into(),
            status: "connected".into(),
            current_rig: 1,
        })
    }
}
