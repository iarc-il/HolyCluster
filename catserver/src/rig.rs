use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

use serde::Serialize;

use crate::freq::Freq;

#[allow(clippy::upper_case_acronyms)]
#[derive(Debug, Clone)]
pub enum Mode {
    USB,
    LSB,
    Data,
    CW,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
#[repr(u8)]
pub enum Slot {
    A = 1,
    #[allow(dead_code)]
    B = 2,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Status {
    // value in hertz
    pub freq: u32,
    pub status: String,
    pub mode: String,
    pub current_rig: u8,
}

pub trait Radio: Send + Sync {
    fn init(&mut self);
    fn get_name(&self) -> &str;
    fn set_mode(&mut self, mode: Mode);
    fn set_rig(&mut self, rig: u8);
    fn set_frequency(&mut self, slot: Slot, freq: Freq);
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

    pub fn read(&self) -> RwLockReadGuard<'_, Box<dyn Radio>> {
        self.0.read().unwrap()
    }
}
