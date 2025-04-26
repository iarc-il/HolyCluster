use std::sync::{Arc, RwLock, RwLockWriteGuard};

use serde::Serialize;

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
#[repr(u8)]
pub enum Rig {
    A = 1,
    B = 2,
    Current = 0,
}

impl Serialize for Rig {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_u8(*self as u8)
    }
}

#[derive(Debug, Serialize)]
pub struct Status {
    pub freq: u32,
    pub status: String,
    pub status_str: String,
    pub current_rig: Rig,
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
