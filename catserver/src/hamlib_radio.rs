use crate::{
    freq::Freq,
    radio_config::HamlibRigConfig,
    rig::{Mode, Radio, RadioBackendContext, RadioInitError, RadioOperationError, Slot, Status},
};

pub(crate) struct HamlibRadio {
    config: HamlibRigConfig,
    rig: Option<hamlib::Rig<hamlib::Open>>,
}

impl HamlibRadio {
    pub(crate) fn new(config: HamlibRigConfig) -> Self {
        Self { config, rig: None }
    }
}

impl Radio for HamlibRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        self.rig = None;
        self.rig = Some(open(&self.config).map_err(|error| init_error(1, error))?);
        Ok(())
    }

    fn tune_spot(&mut self, mode: Mode, frequency: Freq) -> Result<(), RadioOperationError> {
        // set_frequency selects A before writing. Only after selection succeeds
        // may set_mode write the current VFO's mode.
        self.set_frequency(Slot::A, frequency)?;
        self.set_mode(mode)
    }

    fn set_mode(&mut self, mode: Mode) -> Result<(), RadioOperationError> {
        let mut context = RadioBackendContext::new("hamlib", "rig_set_mode", self.rig.is_some());
        context.target = Some("Current");
        context.resolved_mode = Some(match mode {
            Mode::USB => "USB",
            Mode::LSB => "LSB",
            Mode::Data => "PKTUSB",
            Mode::Rtty => "RTTY",
            Mode::CW => "CW",
        });
        self.rig
            .as_mut()
            .ok_or_else(|| unavailable("set mode").with_backend_context(context.clone()))?
            .set_mode(
                hamlib::Vfo::Current,
                hamlib_mode(mode),
                hamlib::PassbandWidth::new(0),
            )
            .map_err(|error| operation_error("set mode", error).with_backend_context(context))
    }

    fn set_frequency(&mut self, slot: Slot, freq: Freq) -> Result<(), RadioOperationError> {
        let frequency = hamlib::Frequency::new(f64::from(freq.as_u32_hz()))
            .map_err(|error| operation_error("validate frequency", error))?;
        let mut selection = RadioBackendContext::new("hamlib", "rig_set_vfo", self.rig.is_some());
        selection.resolved_frequency_hz = Some(freq.as_u32_hz());
        selection.target = Some(match slot {
            Slot::A => "A",
            Slot::B => "B",
        });
        let rig = self
            .rig
            .as_mut()
            .ok_or_else(|| unavailable("set frequency").with_backend_context(selection.clone()))?;
        rig.set_vfo(vfo(slot)).map_err(|error| {
            operation_error("select VFO", error).with_backend_context(selection)
        })?;
        let mut write = RadioBackendContext::new("hamlib", "rig_set_freq", true);
        write.target = Some("Current");
        write.resolved_frequency_hz = Some(freq.as_u32_hz());
        rig.set_frequency(hamlib::Vfo::Current, frequency)
            .map_err(|error| operation_error("set frequency", error).with_backend_context(write))
    }

    fn get_status(&mut self) -> Result<Status, RadioOperationError> {
        let mut context = RadioBackendContext::new("hamlib", "rig_get_freq", self.rig.is_some());
        context.target = Some("Current");
        let result = self
            .rig
            .as_mut()
            .ok_or_else(|| unavailable("read status").with_backend_context(context.clone()))
            .and_then(|rig| {
                let frequency = rig.frequency(hamlib::Vfo::Current).map_err(|error| {
                    operation_error("read frequency", error).with_backend_context(context.clone())
                })?;
                let (mode, _) = rig.mode(hamlib::Vfo::Current).map_err(|error| {
                    context.operation = "rig_get_mode";
                    operation_error("read mode", error).with_backend_context(context)
                })?;
                Ok(Status {
                    freq: frequency.hertz() as u32,
                    status: "connected".into(),
                    mode: status_mode(mode).into(),
                    current_rig: 1,
                })
            });
        if result.is_err() {
            self.rig = None;
        }
        result
    }
}

fn open(config: &HamlibRigConfig) -> Result<hamlib::Rig<hamlib::Open>, OpenError> {
    let model = config
        .model_id
        .parse()
        .map_err(|_| OpenError::message("invalid model id"))?;
    let catalog = hamlib::Catalog::load().map_err(OpenError::from_display)?;
    let port_type = catalog
        .model(hamlib::RigModelId::new(model))
        .map(|model| model.port_type());
    let descriptors = catalog
        .describe_model(hamlib::RigModelId::new(model))
        .map_err(OpenError::from_display)?;
    let model = hamlib::RigModelId::new(model);
    let mut rig = hamlib::Rig::new(model).map_err(OpenError::from_hamlib)?;
    for (token, value) in &config.token_values {
        if matches!(
            port_type,
            Some(hamlib::RigPortType::None | hamlib::RigPortType::Usb)
        ) && matches!(token.as_str(), "rig_pathname" | "pathname" | "device")
        {
            continue;
        }
        let descriptor = descriptors
            .iter()
            .find(|descriptor| descriptor.token().as_str() == token)
            .ok_or_else(|| OpenError::message(format!("unknown config token: {token}")))?;
        let value = descriptor
            .parse_value(value)
            .map_err(OpenError::from_display)?;
        rig.configure(descriptor, &value)
            .map_err(OpenError::from_display)?;
    }
    let mut rig = rig.open().map_err(OpenError::from_hamlib)?;
    // Keep dummy sessions within CATServer's controllable mode set.
    if model == hamlib::RigModelId::DUMMY {
        rig.set_mode(
            hamlib::Vfo::Current,
            hamlib::Mode::Usb,
            hamlib::PassbandWidth::new(0),
        )
        .map_err(OpenError::from_hamlib)?;
    }
    Ok(rig)
}

fn unavailable(operation: &'static str) -> RadioOperationError {
    RadioOperationError::new(1, operation, "radio unavailable")
}

fn operation_error(
    operation: &'static str,
    error: impl std::error::Error + 'static,
) -> RadioOperationError {
    let mut result = RadioOperationError::new(1, operation, error.to_string());
    result.native_error = Some(crate::tracing_setup::native_error(&error));
    result
}

fn init_error(rig: u8, error: OpenError) -> RadioInitError {
    RadioInitError::Hamlib {
        rig,
        error: error.message,
        details: error.details,
        native_error: error.native_error,
    }
}

struct OpenError {
    message: String,
    details: Option<String>,
    native_error: Option<serde_json::Value>,
}

impl OpenError {
    fn message(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            details: None,
            native_error: None,
        }
    }

    fn from_display(error: impl std::error::Error + 'static) -> Self {
        let native_error = Some(crate::tracing_setup::native_error(&error));
        let details = error.to_string();
        Self {
            message: details.lines().next().unwrap_or_default().to_owned(),
            details: details.contains('\n').then_some(details),
            native_error,
        }
    }

    fn from_hamlib(error: hamlib::HamlibError) -> Self {
        let native_error = Some(crate::tracing_setup::native_error(&error));
        let message = error.short_message();
        let details = error.to_string();
        let has_details = details != message;
        Self {
            message,
            details: has_details.then_some(details),
            native_error,
        }
    }
}

#[cfg(test)]
#[path = "hamlib_radio_target_tests.rs"]
mod target_tests;

fn vfo(slot: Slot) -> hamlib::Vfo {
    match slot {
        Slot::A => hamlib::Vfo::A,
        Slot::B => hamlib::Vfo::B,
    }
}

fn hamlib_mode(mode: Mode) -> hamlib::Mode {
    match mode {
        Mode::USB => hamlib::Mode::Usb,
        Mode::Data => hamlib::Mode::PktUsb,
        Mode::Rtty => hamlib::Mode::Rtty,
        Mode::LSB => hamlib::Mode::Lsb,
        Mode::CW => hamlib::Mode::Cw,
    }
}

fn status_mode(mode: hamlib::Mode) -> &'static str {
    match mode {
        hamlib::Mode::Usb | hamlib::Mode::Lsb => "SSB",
        hamlib::Mode::PktUsb | hamlib::Mode::PktLsb => "DIGI",
        hamlib::Mode::Rtty | hamlib::Mode::RttyR => "RTTY",
        hamlib::Mode::Cw => "CW",
        hamlib::Mode::Am => "AM",
        hamlib::Mode::Fm => "FM",
        hamlib::Mode::Unknown(_) => "UNKNOWN",
    }
}
