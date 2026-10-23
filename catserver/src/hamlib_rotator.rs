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
            .map_err(|error| operation_error("validate configuration", error, false))?;
        let model_id = self
            .config
            .model_id
            .parse::<hamlib::RotatorModelId>()
            .map_err(|error| operation_error("parse model", error, false))?;
        let catalog = hamlib::RotatorCatalog::load()
            .map_err(|error| operation_error("load catalog", error, false))?;
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
            .map_err(|error| operation_error("describe model", error, false))?;
        let mut rotator = hamlib::Rotator::new(model_id)
            .map_err(|error| operation_error("initialize", error, false))?;
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
                .map_err(|error| operation_error("parse configuration", error, false))?;
            rotator
                .configure(descriptor, &value)
                .map_err(|error| operation_error("configure", error, false))?;
        }
        let mut handle = rotator
            .open()
            .map_err(|error| operation_error("open", error, false))?;
        handle
            .position()
            .map_err(|error| operation_error("read initial position", error, true))?;
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
            .ok_or_else(|| unavailable("set azimuth"))?
            .set_azimuth(azimuth)
            .map_err(|error| operation_error("set azimuth", error, true));
        if result.is_err() {
            self.handle = None;
        }
        result
    }

    fn stop(&mut self) -> Result<(), RotatorError> {
        let result = self
            .handle
            .as_mut()
            .ok_or_else(|| unavailable("stop"))?
            .stop()
            .map_err(|error| operation_error("stop", error, true));
        if result.is_err() {
            self.handle = None;
        }
        result
    }

    fn status(&mut self) -> Result<RotatorStatus, RotatorError> {
        let result = self
            .handle
            .as_mut()
            .ok_or_else(|| unavailable("read status"))?
            .position()
            .map_err(|error| operation_error("read status", error, true));
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

fn unavailable(operation: &'static str) -> RotatorError {
    let mut error = RotatorError::new(operation, "not initialized");
    error.native_error = Some(
        serde_json::json!({"backend": "hamlib", "operation": operation, "handle_present": false, "hamlib_version": hamlib::version()}),
    );
    error
}

fn operation_error(
    operation: &'static str,
    error: impl std::error::Error + 'static,
    opened_handle_present: bool,
) -> RotatorError {
    let mut result = RotatorError::new(operation, error.to_string());
    let mut native = crate::tracing_setup::native_error(&error);
    native["handle_present"] = opened_handle_present.into();
    result.native_error = Some(native);
    result
}
