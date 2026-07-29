use crate::{
    freq::Freq,
    radio_config::{HamlibConfig, HamlibRigConfig},
    rig::{Mode, Radio, RadioInitError, Slot, Status},
};

pub(crate) struct HamlibRadio {
    config: HamlibConfig,
    rigs: [Option<hamlib::Rig<hamlib::Open>>; 2],
    current_rig: u8,
    failures: u8,
}

impl HamlibRadio {
    pub(crate) fn new(config: HamlibConfig) -> Self {
        Self {
            config,
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
        let rig1 = open(&self.config.rig1).map_err(|error| init_error(1, error))?;
        let rig2 = self
            .config
            .rig2
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
        let Some(rig) = self.rig() else {
            return Status::disconnected(current_rig);
        };
        let status = match (
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
        };
        self.result(status.status == "connected");
        status
    }
}

fn open(config: &HamlibRigConfig) -> Result<hamlib::Rig<hamlib::Open>, String> {
    let model = config
        .model_id
        .parse()
        .map_err(|_| "invalid model id".to_owned())?;
    let catalog = hamlib::Catalog::load().map_err(|error| error.to_string())?;
    let descriptors = catalog
        .describe_model(hamlib::RigModelId::new(model))
        .map_err(|error| error.to_string())?;
    let mut rig =
        hamlib::Rig::new(hamlib::RigModelId::new(model)).map_err(|error| error.to_string())?;
    for (token, value) in &config.token_values {
        let descriptor = descriptors
            .iter()
            .find(|descriptor| descriptor.token().as_str() == token)
            .ok_or_else(|| format!("unknown configuration token: {token}"))?;
        let value = descriptor
            .parse_value(value)
            .map_err(|error| error.to_string())?;
        rig.configure(descriptor, &value)
            .map_err(|error| error.to_string())?;
    }
    rig.open().map_err(|error| error.to_string())
}

fn init_error(rig: u8, error: String) -> RadioInitError {
    RadioInitError::Hamlib { rig, error }
}

fn vfo(slot: Slot) -> hamlib::Vfo {
    match slot {
        Slot::A => hamlib::Vfo::A,
        Slot::B => hamlib::Vfo::B,
    }
}

fn hamlib_mode(mode: Mode) -> hamlib::Mode {
    match mode {
        Mode::USB | Mode::Data => hamlib::Mode::Usb,
        Mode::LSB => hamlib::Mode::Lsb,
        Mode::CW => hamlib::Mode::Cw,
    }
}

fn status_mode(mode: hamlib::Mode) -> &'static str {
    match mode {
        hamlib::Mode::Usb | hamlib::Mode::Lsb => "SSB",
        hamlib::Mode::Cw => "CW",
        hamlib::Mode::Am => "AM",
        hamlib::Mode::Fm => "FM",
    }
}
