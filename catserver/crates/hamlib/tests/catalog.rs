use hamlib::{Catalog, ConfigDescriptor, RigModelId};

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
fn describes_dummy_frontend_pathname_as_owned_text_metadata() {
    let catalog = Catalog::load().expect("Hamlib catalog loads");
    let descriptors = catalog
        .describe_model(RigModelId::DUMMY)
        .expect("dummy descriptor enumeration succeeds");
    let pathname = descriptors
        .iter()
        .find(|descriptor| descriptor.token().as_str() == "rig_pathname")
        .expect("frontend pathname token exists");

    assert!(matches!(pathname, ConfigDescriptor::Path { .. }));
}
