use super::*;

#[test]
fn native_dummy_spot_changes_a_mode_not_previously_selected_b() {
    let mut radio = HamlibRadio::new(HamlibRigConfig {
        model_id: "1".into(),
        token_values: Default::default(),
    });
    radio.init().unwrap();
    let rig = radio.rig.as_mut().unwrap();
    rig.set_vfo(hamlib::Vfo::A).unwrap();
    rig.set_mode(
        hamlib::Vfo::Current,
        hamlib::Mode::Usb,
        hamlib::PassbandWidth::new(0),
    )
    .unwrap();
    rig.set_vfo(hamlib::Vfo::B).unwrap();
    rig.set_mode(
        hamlib::Vfo::Current,
        hamlib::Mode::Lsb,
        hamlib::PassbandWidth::new(0),
    )
    .unwrap();

    radio
        .tune_spot(Mode::CW, Freq::from_u32_hz(7_050_000))
        .unwrap();

    let rig = radio.rig.as_mut().unwrap();
    assert_eq!(rig.mode(hamlib::Vfo::Current).unwrap().0, hamlib::Mode::Cw);
    assert_eq!(
        rig.frequency(hamlib::Vfo::Current).unwrap().hertz(),
        7_050_000.0
    );
    rig.set_vfo(hamlib::Vfo::B).unwrap();
    assert_eq!(rig.mode(hamlib::Vfo::Current).unwrap().0, hamlib::Mode::Lsb);
}
