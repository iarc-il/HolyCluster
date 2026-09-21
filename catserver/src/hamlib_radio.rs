use std::fmt;

use crate::{
    freq::Freq,
    radio_config::HamlibRigConfig,
    rig::{Mode, Radio, RadioInitError, RadioOperationError, Slot, Status},
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

    fn set_mode(&mut self, mode: Mode) -> Result<(), RadioOperationError> {
        self.rig
            .as_mut()
            .ok_or_else(|| unavailable("set mode"))?
            .set_mode(
                hamlib::Vfo::Current,
                hamlib_mode(mode),
                hamlib::PassbandWidth::new(0),
            )
            .map_err(|error| operation_error("set mode", error))
    }

    fn set_frequency(&mut self, slot: Slot, freq: Freq) -> Result<(), RadioOperationError> {
        let frequency = hamlib::Frequency::new(f64::from(freq.as_u32_hz()))
            .map_err(|error| operation_error("validate frequency", error))?;
        let rig = self
            .rig
            .as_mut()
            .ok_or_else(|| unavailable("set frequency"))?;
        rig.set_vfo(vfo(slot))
            .map_err(|error| operation_error("select VFO", error))?;
        rig.set_frequency(hamlib::Vfo::Current, frequency)
            .map_err(|error| operation_error("set frequency", error))
    }

    fn get_status(&mut self) -> Result<Status, RadioOperationError> {
        let result = self
            .rig
            .as_mut()
            .ok_or_else(|| unavailable("read status"))
            .and_then(|rig| {
                let frequency = rig
                    .frequency(hamlib::Vfo::Current)
                    .map_err(|error| operation_error("read frequency", error))?;
                let (mode, _) = rig
                    .mode(hamlib::Vfo::Current)
                    .map_err(|error| operation_error("read mode", error))?;
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
    let mut rig =
        hamlib::Rig::new(hamlib::RigModelId::new(model)).map_err(OpenError::from_hamlib)?;
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
    rig.open().map_err(OpenError::from_hamlib)
}

fn unavailable(operation: &'static str) -> RadioOperationError {
    RadioOperationError::new(1, operation, "radio unavailable")
}

fn operation_error(operation: &'static str, error: impl fmt::Display) -> RadioOperationError {
    RadioOperationError::new(1, operation, error.to_string())
}

fn init_error(rig: u8, error: OpenError) -> RadioInitError {
    RadioInitError::Hamlib {
        rig,
        error: error.message,
        details: error.details,
    }
}

struct OpenError {
    message: String,
    details: Option<String>,
}

impl OpenError {
    fn message(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            details: None,
        }
    }

    fn from_display(error: impl fmt::Display) -> Self {
        let details = error.to_string();
        Self {
            message: details.lines().next().unwrap_or_default().to_owned(),
            details: details.contains('\n').then_some(details),
        }
    }

    fn from_hamlib(error: hamlib::HamlibError) -> Self {
        let message = error.short_message();
        let details = error.to_string();
        let has_details = details != message;
        Self {
            message,
            details: has_details.then_some(details),
        }
    }
}

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
