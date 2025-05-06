// Frequency datatype, stored in hertz units
#[derive(Debug, Clone, Copy)]
pub struct Freq(u32);

impl Freq {
    pub fn from_f32_khz(freq: f32) -> Self {
        Freq((freq * 1000.0) as u32)
    }

    pub fn from_i32_hz(freq: i32) -> Self {
        Freq(freq as u32)
    }

    pub fn from_u32_hz(freq: u32) -> Self {
        Freq(freq)
    }

    pub fn as_u32_hz(&self) -> u32 {
        self.0
    }
}
