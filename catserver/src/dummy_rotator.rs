use crate::rotator::{Rotator, RotatorStatus};
use std::time::Instant;

const ROTATION_SPEED_DEGREES_PER_SECOND: f64 = 10.0;

fn normalize_azimuth(azimuth: f64) -> f64 {
    azimuth.rem_euclid(360.0)
}

fn signed_azimuth_delta(from: f64, to: f64) -> f64 {
    (to - from + 540.0).rem_euclid(360.0) - 180.0
}

#[derive(Clone)]
pub struct DummyRotator {
    azimuth: f64,
    target_azimuth: f64,
    updated_at: Instant,
}

impl DummyRotator {
    pub fn new() -> Self {
        Self {
            azimuth: 0.0,
            target_azimuth: 0.0,
            updated_at: Instant::now(),
        }
    }

    fn update_azimuth(&mut self) {
        let now = Instant::now();
        let elapsed_seconds = now.duration_since(self.updated_at).as_secs_f64();
        self.updated_at = now;

        let delta = signed_azimuth_delta(self.azimuth, self.target_azimuth);
        let step = ROTATION_SPEED_DEGREES_PER_SECOND * elapsed_seconds;
        if delta.abs() <= step {
            self.azimuth = self.target_azimuth;
        } else {
            self.azimuth = normalize_azimuth(self.azimuth + step.copysign(delta));
        }
    }
}

impl Rotator for DummyRotator {
    fn init(&mut self) {}

    fn get_name(&self) -> &str {
        "dummy_rotator"
    }

    fn set_azimuth(&mut self, azimuth: f64) {
        self.update_azimuth();
        self.target_azimuth = normalize_azimuth(azimuth);
    }

    fn get_status(&mut self) -> RotatorStatus {
        self.update_azimuth();
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
