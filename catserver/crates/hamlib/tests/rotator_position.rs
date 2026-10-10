use hamlib::{Rotator, RotatorCatalog, RotatorModelId};

#[test]
fn invalid_heading_leaves_dummy_position_unchanged() {
    let mut rotator = Rotator::new(RotatorModelId::DUMMY).unwrap().open().unwrap();
    let before = rotator.position().unwrap();
    for heading in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        assert!(rotator.set_azimuth(heading).is_err());
        assert_eq!(rotator.position().unwrap(), before);
    }
}

#[test]
fn real_azimuth_only_model_has_explicit_capability() {
    let catalog = RotatorCatalog::load().unwrap();
    let model = catalog
        .models()
        .iter()
        .find(|model| model.model() == "GS-232A azimuth")
        .unwrap();
    // Initialize only: no serial port or actual hardware is opened.
    let handle = unsafe { hamlib_sys::rot_init(model.id().get()) };
    assert!(!handle.is_null());
    assert_eq!(
        unsafe { hamlib_sys::hamlib_sys_rot_is_azimuth_only(handle) },
        1
    );
    assert_eq!(unsafe { hamlib_sys::rot_cleanup(handle) }, 0);
}
