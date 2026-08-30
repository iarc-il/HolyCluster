use std::collections::BTreeMap;

use crate::{
    freq::Freq,
    hamlib_radio::HamlibRadio,
    radio_config::HamlibRigConfig,
    rig::{Mode, Radio, Slot},
};

fn config(rig2: bool) -> (HamlibRigConfig, Option<HamlibRigConfig>) {
    (
        HamlibRigConfig {
            model_id: hamlib::RigModelId::DUMMY.to_string(),
            token_values: BTreeMap::new(),
        },
        rig2.then(|| HamlibRigConfig {
            model_id: hamlib::RigModelId::DUMMY.to_string(),
            token_values: BTreeMap::new(),
        }),
    )
}

#[test]
fn dummy_rigs_select_vfos_and_map_modes() {
    let (rig1, rig2) = config(true);
    let mut radio = HamlibRadio::new(rig1, rig2);
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
fn dummy_ignores_a_persisted_serial_path() {
    let (mut rig1, rig2) = config(false);
    rig1.token_values
        .insert("rig_pathname".into(), "/dev/ttyS0".into());
    let mut radio = HamlibRadio::new(rig1, rig2);
    radio.init().unwrap();
    assert_eq!(radio.get_status().current_rig, 1);
}

#[test]
fn absent_second_rig_is_not_selected() {
    let (rig1, rig2) = config(false);
    let mut radio = HamlibRadio::new(rig1, rig2);
    radio.init().unwrap();
    radio.set_rig(2);
    assert_eq!(radio.get_status().current_rig, 1);
}

#[test]
fn invalid_second_rig_reports_its_slot_and_can_retry() {
    let (rig1, mut rig2) = config(true);
    rig2.as_mut().unwrap().model_id = "999999".into();
    let mut radio = HamlibRadio::new(rig1, rig2);
    assert!(matches!(
        radio.init(),
        Err(crate::rig::RadioInitError::Hamlib { rig: 2, .. })
    ));
    assert!(matches!(
        radio.init(),
        Err(crate::rig::RadioInitError::Hamlib { rig: 2, .. })
    ));
}
