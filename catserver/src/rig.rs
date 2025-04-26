use std::sync::{Arc, RwLock, RwLockWriteGuard};

#[allow(clippy::upper_case_acronyms)]
#[derive(Debug, Clone)]
pub enum Mode {
    USB,
    LSB,
    FT8,
    FT4,
    DIGI,
    CW,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum Rig {
    A,
    B,
    Current,
}

pub struct Status {
    freq: u32,
    status: String,
    status_str: String,
    current_rig: Rig,
}

pub trait Radio: Send + Sync {
    fn init(&mut self);
    fn set_mode(&mut self, mode: Mode);
    fn set_rig(&mut self, rig: Rig);
    fn set_frequency(&mut self, rig: Rig, freq: u32);
    fn get_status(&mut self) -> Status;
}

#[derive(Clone)]
pub struct AnyRadio(Arc<RwLock<Box<dyn Radio + 'static>>>);
unsafe impl Send for AnyRadio {}
unsafe impl Sync for AnyRadio {}

impl AnyRadio {
    pub fn new<R: Radio + 'static>(radio: R) -> Self {
        AnyRadio(Arc::new(RwLock::new(Box::new(radio))))
    }

    pub fn write(&self) -> RwLockWriteGuard<'_, Box<dyn Radio>> {
        self.0.write().unwrap()
    }
}

#[derive(Clone)]
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
    fn init(&mut self) {
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

    fn set_frequency(&mut self, mut rig: Rig, freq: u32) {
        println!("Setting rig: {rig:?} to freq: {freq}");
        if rig == Rig::Current {
            rig = self.current_rig;
        }
        match rig {
            Rig::A => {
                self.freq_a = freq;
            }
            Rig::B => {
                self.freq_b = freq;
            }
            _ => {
                panic!();
            }
        }
    }

    fn get_status(&mut self) -> Status {
        Status {
            freq: match self.current_rig {
                Rig::A => self.freq_a,
                Rig::B => self.freq_b,
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
