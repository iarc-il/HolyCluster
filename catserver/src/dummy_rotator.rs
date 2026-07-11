use crate::rotator::{Rotator, RotatorStatus};

#[derive(Clone)]
pub struct DummyRotator {
    azimuth: f64,
}

impl DummyRotator {
    pub fn new() -> Self {
        Self { azimuth: 0.0 }
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

    fn get_status(&mut self) -> RotatorStatus {
        RotatorStatus {
            azimuth: self.azimuth,
            status: "connected".into(),
            name: self.get_name().into(),
        }
    }

    fn is_available(&self) -> bool {
        true
    }
}
