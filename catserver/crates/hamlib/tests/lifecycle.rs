use hamlib::{Catalog, ConfigDescriptor, Frequency, Mode, PassbandWidth, Rig, RigModelId, Vfo};

#[test]
fn dummy_configures_opens_controls_closes_and_reopens() {
    let catalog = Catalog::load().expect("Hamlib catalog loads");
    let descriptor = catalog
        .describe_model(RigModelId::DUMMY)
        .expect("dummy descriptors load")
        .into_iter()
        .find(|descriptor| descriptor.token().as_str() == "rig_pathname")
        .expect("dummy pathname descriptor exists");
    let default = match &descriptor {
        ConfigDescriptor::Path { default, .. } => default,
        _ => panic!("dummy pathname descriptor is a path"),
    };
    let value = descriptor
        .parse_value(default)
        .expect("dummy pathname default is valid");

    let mut closed = Rig::new(RigModelId::DUMMY).expect("dummy handle initializes");
    closed
        .configure(&descriptor, &value)
        .expect("dummy accepts pathname configuration");
    let mut open = closed.open().expect("dummy opens");
    open.set_vfo(Vfo::A).expect("dummy selects VFO A");
    open.set_frequency(
        Vfo::A,
        Frequency::new(14_074_000.0).expect("valid frequency"),
    )
    .expect("dummy sets frequency");
    assert_eq!(
        open.frequency(Vfo::A)
            .expect("dummy reads frequency")
            .hertz(),
        14_074_000.0
    );
    open.set_mode(Vfo::A, Mode::Usb, PassbandWidth::new(0))
        .expect("dummy sets mode");
    assert_eq!(open.mode(Vfo::A).expect("dummy reads mode").0, Mode::Usb);
    let mut reopened = open
        .close()
        .expect("dummy closes")
        .open()
        .expect("dummy reopens");
    assert_eq!(reopened.vfo().expect("dummy reads VFO"), Vfo::A);
    reopened.close().expect("dummy closes again");
}
