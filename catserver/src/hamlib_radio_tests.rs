use std::collections::BTreeMap;

use crate::{
    freq::Freq,
    hamlib_radio::HamlibRadio,
    radio_config::{HamlibConfig, HamlibRigConfig},
    rig::{Mode, Radio, Slot},
};

fn config(rig2: bool) -> HamlibConfig {
    HamlibConfig {
        rig1: HamlibRigConfig {
            model_id: hamlib::RigModelId::DUMMY.to_string(),
            token_values: BTreeMap::new(),
        },
        rig2: rig2.then(|| HamlibRigConfig {
            model_id: hamlib::RigModelId::DUMMY.to_string(),
            token_values: BTreeMap::new(),
        }),
    }
}

#[test]
fn dummy_rigs_select_vfos_and_map_modes() {
    let mut radio = HamlibRadio::new(config(true));
    radio.init().unwrap();
    radio.set_frequency(Slot::A, Freq::from_u32_hz(7_100_000));
    radio.set_mode(Mode::CW);
    assert_eq!(radio.get_status().freq, 7_100_000);
    assert_eq!(radio.get_status().mode, "CW");

    radio.set_rig(2);
    radio.set_frequency(Slot::B, Freq::from_u32_hz(14_200_000));
    radio.set_mode(Mode::Data);
    assert_eq!(radio.get_status().current_rig, 2);
    assert_eq!(radio.get_status().freq, 14_200_000);
    assert_eq!(radio.get_status().mode, "SSB");
}

#[test]
fn absent_second_rig_is_not_selected() {
    let mut radio = HamlibRadio::new(config(false));
    radio.init().unwrap();
    radio.set_rig(2);
    assert_eq!(radio.get_status().current_rig, 1);
}

#[test]
fn invalid_second_rig_reports_its_slot_and_can_retry() {
    let mut config = config(true);
    config.rig2.as_mut().unwrap().model_id = "999999".into();
    let mut radio = HamlibRadio::new(config);
    assert!(matches!(
        radio.init(),
        Err(crate::rig::RadioInitError::Hamlib { rig: 2, .. })
    ));
    assert!(matches!(
        radio.init(),
        Err(crate::rig::RadioInitError::Hamlib { rig: 2, .. })
    ));
}
