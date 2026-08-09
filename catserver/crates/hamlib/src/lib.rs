#![deny(unsafe_code)]

mod config;
mod descriptor;
mod error;
mod ffi;
mod rig;
mod rotator;
mod types;

#[cfg(test)]
mod safety_tests;

pub use error::{
    CatalogError, ConfigTokenError, ConfigValueError, ConfigurationError, HamlibError,
    RigControlError,
};
pub use rig::{Closed, Frequency, Mode, Open, PassbandWidth, Rig, Vfo};
pub use rotator::{Position, Rotator, RotatorCatalog, RotatorClosed, RotatorModel, RotatorOpen};
pub use types::{ConfigDescriptor, ConfigToken, ConfigValue, RigModel, RigModelId, RigModelStatus};

#[derive(Clone, Debug)]
pub struct Catalog {
    models: Vec<RigModel>,
}

impl Catalog {
    pub fn load() -> Result<Self, CatalogError> {
        Ok(Self {
            models: ffi::models()?,
        })
    }

    pub fn models(&self) -> &[RigModel] {
        &self.models
    }

    pub fn model(&self, id: RigModelId) -> Option<&RigModel> {
        self.models.iter().find(|model| model.id() == id)
    }

    pub fn describe_model(&self, id: RigModelId) -> Result<Vec<ConfigDescriptor>, CatalogError> {
        if self.model(id).is_none() {
            return Err(CatalogError::UnknownModel { model: id });
        }
        ffi::descriptors(id)
    }
}
