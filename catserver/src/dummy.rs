use crate::freq::Freq;
use crate::rig::{Mode, Radio, RadioInitError, RadioOperationError, Slot, Status};

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
    fn init(&mut self) -> Result<(), RadioInitError> {
        Ok(())
    }

    fn set_mode(&mut self, mode: Mode) -> Result<(), RadioOperationError> {
        self.mode = mode;
        Ok(())
    }

    fn set_rig(&mut self, rig: u8) -> Result<(), RadioOperationError> {
        if rig != 1 && rig != 2 {
            return Err(RadioOperationError::new(
                rig,
                "select rig",
                "invalid rig number",
            ));
        }
        self.current_rig = rig;
        Ok(())
    }

    fn set_frequency(&mut self, slot: Slot, freq: Freq) -> Result<(), RadioOperationError> {
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
            (_, rig) => {
                return Err(RadioOperationError::new(
                    rig,
                    "set frequency",
                    "invalid rig number",
                ));
            }
        }
        Ok(())
    }

    fn get_status(&mut self) -> Status {
        Status {
            // Currently slot b is not in the status message
            freq: match self.current_rig {
                1 => self.freq_a1.as_u32_hz(),
                2 => self.freq_a2.as_u32_hz(),
                rig => {
                    tracing::error!(rig, "Invalid dummy rig in status request");
                    0
                }
            },
            mode: "SSB".into(),
            status: "connected".into(),
            current_rig: self.current_rig,
        }
    }
}
