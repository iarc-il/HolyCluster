use std::sync::Arc;

use crate::{
    hamlib_rotator::HamlibRotator, rotator_actor::RotatorFactory, rotator_config::RotatorConfig,
};

pub(crate) fn factory(config: &RotatorConfig) -> Option<(String, RotatorFactory)> {
    let hamlib = config.hamlib()?.clone();
    let selected = format!("hamlib:{}", hamlib.model_id);
    let factory: RotatorFactory = Arc::new(move || Box::new(HamlibRotator::new(hamlib.clone())));
    Some((selected, factory))
}
