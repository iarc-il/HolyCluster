use crate::{
    hamlib_device_config::HamlibDeviceConfig,
    rotator::{Rotator, RotatorError, RotatorStatus},
};

pub(crate) struct HamlibRotator {
    config: HamlibDeviceConfig,
    handle: Option<hamlib::Rotator<hamlib::RotatorOpen>>,
    name: String,
}

impl HamlibRotator {
    pub(crate) fn new(config: HamlibDeviceConfig) -> Self {
        Self {
            config,
            handle: None,
            name: "Hamlib rotator".into(),
        }
    }
}

impl Rotator for HamlibRotator {
    fn init(&mut self) -> Result<(), RotatorError> {
        self.handle = None;
        self.config
            .validate()
            .map_err(|error| operation_error("validate configuration", error))?;
        let model_id = self
            .config
            .model_id
            .parse::<hamlib::RotatorModelId>()
            .map_err(|error| operation_error("parse model", error))?;
        let catalog = hamlib::RotatorCatalog::load()
            .map_err(|error| operation_error("load catalog", error))?;
        let model = catalog.model(model_id).ok_or_else(|| {
            RotatorError::new("select model", format!("unknown model {model_id}"))
        })?;
        if !model.can_get_position() || !model.can_set_position() {
            return Err(RotatorError::new(
                "select model",
                format!("model {model_id} cannot get and set position"),
            ));
        }
        self.name = format!("{} {}", model.manufacturer(), model.model());
        let port_type = model.port_type();
        let descriptors = catalog
            .describe_model(model_id)
            .map_err(|error| operation_error("describe model", error))?;
        let mut rotator =
            hamlib::Rotator::new(model_id).map_err(|error| operation_error("initialize", error))?;
        for (token, value) in &self.config.token_values {
            if matches!(
                port_type,
                hamlib::RigPortType::None | hamlib::RigPortType::Usb
            ) && matches!(token.as_str(), "rot_pathname" | "pathname" | "device")
            {
                continue;
            }
            let descriptor = descriptors
                .iter()
                .find(|descriptor| descriptor.token().as_str() == token)
                .ok_or_else(|| {
                    RotatorError::new("configure", format!("unknown config token {token}"))
                })?;
            let value = descriptor
                .parse_value(value)
                .map_err(|error| operation_error("parse configuration", error))?;
            rotator
                .configure(descriptor, &value)
                .map_err(|error| operation_error("configure", error))?;
        }
        let mut handle = rotator
            .open()
            .map_err(|error| operation_error("open", error))?;
        handle
            .position()
            .map_err(|error| operation_error("read initial position", error))?;
        self.handle = Some(handle);
        Ok(())
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn set_azimuth(&mut self, azimuth: f64) -> Result<(), RotatorError> {
        let result = self
            .handle
            .as_mut()
            .ok_or_else(|| RotatorError::new("set azimuth", "not initialized"))?
            .set_azimuth(azimuth)
            .map_err(|error| operation_error("set azimuth", error));
        if result.is_err() {
            self.handle = None;
        }
        result
    }

    fn status(&mut self) -> Result<RotatorStatus, RotatorError> {
        let result = self
            .handle
            .as_mut()
            .ok_or_else(|| RotatorError::new("read status", "not initialized"))?
            .position()
            .map_err(|error| operation_error("read status", error));
        match result {
            Ok(position) => Ok(RotatorStatus {
                azimuth: position.azimuth,
                status: "connected".into(),
                name: self.name.clone(),
            }),
            Err(error) => {
                self.handle = None;
                Err(error)
            }
        }
    }
}

fn operation_error(operation: &'static str, error: impl std::fmt::Display) -> RotatorError {
    RotatorError::new(operation, error.to_string())
}
