use hamlib::{RigModelStatus, RigPortType, RotatorCatalog, RotatorModelId};

#[test]
fn loads_rotator_backends_without_loading_radio_catalog() {
    let catalog = RotatorCatalog::load().expect("Hamlib rotator catalog loads");

    for model in [
        RotatorModelId::DUMMY,
        RotatorModelId::NET_ROTCTL,
        RotatorModelId::PSTROTATOR,
    ] {
        assert!(
            catalog.model(model).is_some(),
            "rotator model {model} is registered"
        );
    }
}

#[test]
fn lists_rotator_models_in_deterministic_order() {
    let first = RotatorCatalog::load().expect("Hamlib rotator catalog loads");
    let second = RotatorCatalog::load().expect("Hamlib rotator catalog reloads");

    assert_eq!(first.models(), second.models());
    assert!(first.models().windows(2).all(|models| {
        let left = &models[0];
        let right = &models[1];
        (left.manufacturer(), left.model(), left.id())
            <= (right.manufacturer(), right.model(), right.id())
    }));
}

#[test]
fn exposes_pinned_rotator_metadata_and_capabilities() {
    let catalog = RotatorCatalog::load().expect("Hamlib rotator catalog loads");
    let expected = [
        (
            RotatorModelId::DUMMY,
            "Hamlib",
            "Dummy",
            RigPortType::None,
        ),
        (
            RotatorModelId::NET_ROTCTL,
            "Hamlib",
            "NET rotctl",
            RigPortType::Network,
        ),
        (
            RotatorModelId::PSTROTATOR,
            "YO3DMU",
            "PstRotator",
            RigPortType::UdpNetwork,
        ),
    ];

    for (id, manufacturer, name, port_type) in expected {
        let model = catalog.model(id).expect("pinned model is registered");
        assert_eq!(model.manufacturer(), manufacturer);
        assert_eq!(model.model(), name);
        assert_eq!(model.status(), RigModelStatus::Stable);
        assert_eq!(model.port_type(), port_type);
        assert!(model.can_get_position());
        assert!(model.can_set_position());
        assert!(!model.version().is_empty());
        assert!(model.azimuth_range().contains(&0.0));
    }
}
