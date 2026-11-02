use crate::rig::Slot;

pub(crate) const PM_FREQ: u32 = 0x0000_0002;
pub(crate) const PM_FREQ_A: u32 = 0x0000_0004;
pub(crate) const PM_FREQ_B: u32 = 0x0000_0008;
const FREQUENCY_PARAMS: u32 = PM_FREQ | PM_FREQ_A | PM_FREQ_B;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum FrequencyProperty {
    Current,
    A,
    B,
}

impl FrequencyProperty {
    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::Current => "Freq",
            Self::A => "FreqA",
            Self::B => "FreqB",
        }
    }
}

pub(crate) const fn has_readable_frequency(readable: u32) -> bool {
    readable & FREQUENCY_PARAMS != 0
}

pub(crate) const fn select_write_property(slot: Slot, writable: u32) -> Option<FrequencyProperty> {
    match slot {
        Slot::A if writable & PM_FREQ != 0 => Some(FrequencyProperty::Current),
        Slot::A if writable & PM_FREQ_A != 0 => Some(FrequencyProperty::A),
        Slot::B if writable & PM_FREQ_B != 0 => Some(FrequencyProperty::B),
        Slot::A | Slot::B => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generic_frequency_wins_for_slot_a() {
        assert_eq!(
            select_write_property(Slot::A, PM_FREQ | PM_FREQ_A),
            Some(FrequencyProperty::Current)
        );
    }

    #[test]
    fn slot_a_falls_back_to_explicit_a() {
        assert_eq!(
            select_write_property(Slot::A, PM_FREQ_A),
            Some(FrequencyProperty::A)
        );
    }

    #[test]
    fn slot_b_requires_explicit_b() {
        assert_eq!(select_write_property(Slot::B, PM_FREQ | PM_FREQ_A), None);
        assert_eq!(
            select_write_property(Slot::B, PM_FREQ_B),
            Some(FrequencyProperty::B)
        );
    }

    #[test]
    fn unsupported_slot_a_frequency_is_rejected() {
        assert_eq!(select_write_property(Slot::A, 0), None);
    }

    #[test]
    fn recognizes_any_readable_frequency() {
        assert!(has_readable_frequency(PM_FREQ));
        assert!(has_readable_frequency(PM_FREQ_A));
        assert!(has_readable_frequency(PM_FREQ_B));
        assert!(!has_readable_frequency(0));
    }

    #[test]
    fn property_names_match_omnirig() {
        assert_eq!(FrequencyProperty::Current.name(), "Freq");
        assert_eq!(FrequencyProperty::A.name(), "FreqA");
        assert_eq!(FrequencyProperty::B.name(), "FreqB");
    }
}
