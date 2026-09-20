use hamlib::{RotatorCatalog, RotatorModelId};

#[test]
fn loads_rotator_backends_without_loading_radio_catalog() {
    let catalog = RotatorCatalog::load().expect("Hamlib rotator catalog loads");

    for model in [
        RotatorModelId::DUMMY,
        RotatorModelId::NET_ROTCTL,
        RotatorModelId::PSTROTATOR,
    ] {
        assert!(catalog.model(model).is_some(), "rotator model {model} is registered");
    }
}
