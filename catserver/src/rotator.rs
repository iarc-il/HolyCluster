use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RotatorStatus {
    pub azimuth: f64,
    pub status: String,
    pub name: String,
}

pub trait Rotator: Send + Sync {
    fn init(&mut self);
    fn get_name(&self) -> &str;
    fn set_azimuth(&mut self, azimuth: f64);
    fn get_status(&mut self) -> RotatorStatus;
    fn is_available(&self) -> bool;
}

#[derive(Clone)]
pub struct AnyRotator(Arc<RwLock<Box<dyn Rotator + 'static>>>);
unsafe impl Send for AnyRotator {}
unsafe impl Sync for AnyRotator {}

impl AnyRotator {
    pub fn new<R: Rotator + 'static>(rotator: R) -> Self {
        AnyRotator(Arc::new(RwLock::new(Box::new(rotator))))
    }

    pub fn write(&self) -> RwLockWriteGuard<'_, Box<dyn Rotator>> {
        match self.0.write() {
            Ok(guard) => guard,
            Err(error) => {
                tracing::error!("Rotator write lock was poisoned; recovering");
                self.0.clear_poison();
                error.into_inner()
            }
        }
    }

    pub fn read(&self) -> RwLockReadGuard<'_, Box<dyn Rotator>> {
        match self.0.read() {
            Ok(guard) => guard,
            Err(error) => {
                tracing::error!("Rotator read lock was poisoned; recovering");
                self.0.clear_poison();
                error.into_inner()
            }
        }
    }

    pub fn is_available(&self) -> bool {
        self.read().is_available()
    }
}
