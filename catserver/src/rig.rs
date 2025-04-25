#[derive(Debug)]
pub enum Mode {
    USB,
    LSB,
    FT8,
    FT4,
    DIGI,
    CW,
}

#[derive(Debug, Clone, Copy)]
pub enum Rig {
    A,
    B,
}

pub struct Status {
    freq: u32,
    status: String,
    status_str: String,
    current_rig: Rig,
}

pub trait Radio {
    fn init();
    fn set_mode(&mut self, mode: Mode);
    fn set_rig(&mut self, rig: Rig);
    fn set_frequency(&mut self, rig: Rig, freq: u32);
    fn get_status(&mut self) -> Status;
}

pub struct DummyRadio {
    mode: Mode,
    freq_a: u32,
    freq_b: u32,
    current_rig: Rig,
}

impl DummyRadio {
    pub fn new() -> Self {
        Self {
            mode: Mode::USB,
            freq_a: 0,
            freq_b: 0,
            current_rig: Rig::A,
        }
    }
}

impl Radio for DummyRadio {
    fn init() {
        println!("Initialize radio");
    }

    fn set_mode(&mut self, mode: Mode) {
        println!("Setting mode: {mode:?}");
        self.mode = mode;
    }

    fn set_rig(&mut self, rig: Rig) {
        println!("Set rig: {rig:?}");
        self.current_rig = rig;
    }

    fn set_frequency(&mut self, rig: Rig, freq: u32) {
        println!("Setting rig: {rig:?} to freq: {freq}");
        match self.current_rig {
            Rig::A => {
                self.freq_a = freq;
            }
            Rig::B => {
                self.freq_b = freq;
            }
        }
    }

    fn get_status(&mut self) -> Status {
        Status {
            freq: match self.current_rig {
                Rig::A => self.freq_a,
                Rig::B => self.freq_b,
            },
            status: "connected".into(),
            status_str: "".into(),
            current_rig: self.current_rig,
        }
    }
}
