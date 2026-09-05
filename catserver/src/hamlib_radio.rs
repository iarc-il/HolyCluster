use std::fmt;

use crate::{
    freq::Freq,
    radio_config::HamlibRigConfig,
    rig::{Mode, Radio, RadioInitError, Slot, Status},
};

pub(crate) struct HamlibRadio {
    config: [Option<HamlibRigConfig>; 2],
    rigs: [Option<hamlib::Rig<hamlib::Open>>; 2],
    current_rig: u8,
    failures: u8,
}

impl HamlibRadio {
    pub(crate) fn new(rig1: HamlibRigConfig, rig2: Option<HamlibRigConfig>) -> Self {
        Self {
            config: [Some(rig1), rig2],
            rigs: [None, None],
            current_rig: 1,
            failures: 0,
        }
    }

    fn rig(&mut self) -> Option<&mut hamlib::Rig<hamlib::Open>> {
        self.rigs
            .get_mut(usize::from(self.current_rig - 1))?
            .as_mut()
    }

    fn result(&mut self, success: bool) {
        self.failures = if success { 0 } else { self.failures + 1 };
        if self.failures == 5 {
            self.failures = 0;
            let _ = self.init();
        }
    }
}

impl Radio for HamlibRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        self.rigs = [None, None];
        let rig1 = open(self.config[0].as_ref().expect("rig 1 configuration"))
            .map_err(|error| init_error(1, error))?;
        let rig2 = self
            .config
            .get(1)
            .expect("rig 2 configuration")
            .as_ref()
            .map(open)
            .transpose()
            .map_err(|error| init_error(2, error))?;
        self.rigs = [Some(rig1), rig2];
        self.failures = 0;
        Ok(())
    }

    fn set_mode(&mut self, mode: Mode) {
        let result = self.rig().map(|rig| {
            rig.set_mode(
                hamlib::Vfo::Current,
                hamlib_mode(mode),
                hamlib::PassbandWidth::new(0),
            )
        });
        self.result(result.is_some_and(|result| result.is_ok()));
    }

    fn set_rig(&mut self, rig: u8) {
        if (1..=2).contains(&rig) && self.rigs[usize::from(rig - 1)].is_some() {
            self.current_rig = rig;
        }
    }

    fn set_frequency(&mut self, slot: Slot, freq: Freq) {
        let result = if let (Some(rig), Ok(frequency)) = (
            self.rig(),
            hamlib::Frequency::new(f64::from(freq.as_u32_hz())),
        ) && rig.set_vfo(vfo(slot)).is_ok()
        {
            rig.set_frequency(hamlib::Vfo::Current, frequency).is_ok()
        } else {
            false
        };
        self.result(result);
    }

    fn get_status(&mut self) -> Status {
        let current_rig = self.current_rig;
        let status = if let Some(rig) = self.rig() {
            match (
                rig.frequency(hamlib::Vfo::Current),
                rig.mode(hamlib::Vfo::Current),
            ) {
                (Ok(frequency), Ok((mode, _))) => Status {
                    freq: frequency.hertz() as u32,
                    status: "connected".into(),
                    mode: status_mode(mode).into(),
                    current_rig,
                },
                _ => Status::disconnected(current_rig),
            }
        } else {
            Status::disconnected(current_rig)
        };
        if status.status == "disconnected" {
            self.rigs = [None, None];
        }
        self.result(status.status == "connected");
        status
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
