use serde::Serialize;

#[derive(Debug, Copy, Clone, Serialize)]
pub struct Khz(pub u32);
#[derive(Debug, Copy, Clone, Serialize)]
pub struct Hz(pub u32);

impl From<Khz> for Hz {
    fn from(khz: Khz) -> Hz {
        Hz(khz.0 * 1000)
    }
}

impl From<Hz> for Khz {
    fn from(hz: Hz) -> Khz {
        Khz(hz.0 / 1000)
    }
}

impl From<u32> for Khz {
    fn from(khz: u32) -> Self {
        Khz(khz)
    }
}

impl From<i32> for Khz {
    fn from(khz: i32) -> Self {
        Khz(khz as u32)
    }
}

impl From<u32> for Hz {
    fn from(hz: u32) -> Self {
        Hz(hz)
    }
}

impl From<i32> for Hz {
    fn from(hz: i32) -> Self {
        Hz(hz as u32)
    }
}
