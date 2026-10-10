use std::sync::Arc;

use crate::{
    hamlib_rotator::HamlibRotator, rotator_actor::RotatorFactory, rotator_config::RotatorConfig,
    rotator_manager::ActiveRotatorBackend,
};

pub(crate) fn factory(config: &RotatorConfig) -> Option<(ActiveRotatorBackend, RotatorFactory)> {
    let hamlib = config.hamlib()?.clone();
    let selected = ActiveRotatorBackend::Configured(hamlib.clone());
    let factory: RotatorFactory = Arc::new(move || Box::new(HamlibRotator::new(hamlib.clone())));
    Some((selected, factory))
}
