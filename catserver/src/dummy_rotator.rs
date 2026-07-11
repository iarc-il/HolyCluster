use crate::rotator::{Rotator, RotatorStatus};

#[derive(Clone)]
pub struct DummyRotator {
    azimuth: f64,
    elevation: f64,
}

impl DummyRotator {
    pub fn new() -> Self {
        Self {
            azimuth: 0.0,
            elevation: 0.0,
        }
    }
}

impl Rotator for DummyRotator {
    fn init(&mut self) {}

    fn get_name(&self) -> &str {
        "dummy_rotator"
    }

    fn set_azimuth(&mut self, azimuth: f64) {
        self.azimuth = azimuth;
    }

    fn set_elevation(&mut self, elevation: f64) {
        self.elevation = elevation;
    }

    fn get_status(&mut self) -> RotatorStatus {
        RotatorStatus {
            azimuth: self.azimuth,
            elevation: self.elevation,
            status: "connected".into(),
            name: self.get_name().into(),
        }
    }

    fn is_available(&self) -> bool {
        true
    }
}