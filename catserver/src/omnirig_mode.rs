use crate::rig::Mode;

pub(crate) fn resolve(mode: Mode) -> (i32, &'static str) {
    match mode {
        Mode::LSB => (0x04000000, "LSB"),
        Mode::USB => (0x02000000, "USB"),
        Mode::CW => (0x00800000, "CW"),
        Mode::Data => (0x08000000, "DIG_U"),
        Mode::Rtty => (0x10000000, "DIG_L"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn digital_modes_use_wsjt_x_omnirig_convention() {
        assert_eq!(resolve(Mode::Data), (0x08000000, "DIG_U"));
        assert_eq!(resolve(Mode::Rtty), (0x10000000, "DIG_L"));
    }
}
