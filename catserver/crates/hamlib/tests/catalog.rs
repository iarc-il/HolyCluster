use hamlib::{Catalog, ConfigDescriptor, RigModelId, RigPortType};

#[test]
fn lists_owned_dummy_model_in_deterministic_order() {
    let first = Catalog::load().expect("Hamlib catalog loads");
    let second = Catalog::load().expect("Hamlib catalog reloads");

    assert_eq!(first.models(), second.models());
    assert!(first.models().windows(2).all(|models| {
        let left = &models[0];
        let right = &models[1];
        (left.manufacturer(), left.model(), left.id())
            <= (right.manufacturer(), right.model(), right.id())
    }));

    let dummy = first
        .model(RigModelId::DUMMY)
        .expect("the real dummy model is registered");
    assert!(!dummy.manufacturer().is_empty());
    assert!(!dummy.model().is_empty());
}

#[test]
fn describes_every_registered_model_without_catalog_errors() {
    let catalog = Catalog::load().expect("Hamlib catalog loads");
    let failures: Vec<String> = catalog
        .models()
        .iter()
        .filter_map(|model| {
            catalog.describe_model(model.id()).err().map(|error| {
                format!(
                    "{} {} (model {}): {error}",
                    model.manufacturer(),
                    model.model(),
                    model.id()
                )
            })
        })
        .collect();
    assert!(
        failures.is_empty(),
        "models with unusable configuration metadata:\n{}",
        failures.join("\n")
    );
}

#[test]
fn exposes_model_port_types() {
    let catalog = Catalog::load().expect("Hamlib catalog loads");
    let net_rigctl = catalog
        .models()
        .iter()
        .find(|model| model.model() == "NET rigctl")
        .expect("NET rigctl model is registered");

    assert_eq!(net_rigctl.port_type(), RigPortType::Network);
    assert_eq!(
        catalog
            .model(RigModelId::DUMMY)
            .expect("the real dummy model is registered")
            .port_type(),
        RigPortType::None
    );
}

#[test]
fn describes_dummy_frontend_pathname_as_owned_text_metadata() {
    let catalog = Catalog::load().expect("Hamlib catalog loads");
    let descriptors = catalog
        .describe_model(RigModelId::DUMMY)
        .expect("dummy descriptor enumeration succeeds");
    let pathname = descriptors
        .iter()
        .find(|descriptor| descriptor.token().as_str() == "rig_pathname")
        .expect("frontend pathname token exists");

    assert!(matches!(
        pathname,
        ConfigDescriptor::Path { default, .. } if default.is_empty()
    ));
}
