use winsafe::guard::CoUninitializeGuard;
use winsafe::prelude::oleaut_IDispatch;
use winsafe::{CLSIDFromProgID, CoInitializeEx, IDispatch, co};

use crate::freq::Freq;
use crate::radio_config::OmniRigSlot;
use crate::rig::{Mode, Radio, RadioInitError, RadioOperationError, Slot, Status};

struct OmnirigInner {
    com_guard: CoUninitializeGuard,
    _omnirig: IDispatch,
    rig: IDispatch,
}

pub struct OmnirigRadio {
    slot: OmniRigSlot,
    inner: Option<OmnirigInner>,
    omnirig_available: bool,
}
impl OmnirigRadio {
    pub fn new(slot: OmniRigSlot) -> Self {
        Self {
            slot,
            inner: None,
            omnirig_available: false,
        }
    }

    fn rig_number(&self) -> u8 {
        match self.slot {
            OmniRigSlot::Rig1 => 1,
            OmniRigSlot::Rig2 => 2,
        }
    }

    fn property_name(&self) -> &'static str {
        match self.slot {
            OmniRigSlot::Rig1 => "Rig1",
            OmniRigSlot::Rig2 => "Rig2",
        }
    }

    fn get_rig_dispatch(omnirig: &IDispatch, property_name: &str) -> Option<IDispatch> {
        match omnirig.invoke_get(property_name, &[]) {
            Ok(winsafe::Variant::Dispatch(dispatch)) => Some(dispatch),
            Ok(_) => {
                tracing::error!(
                    property_name,
                    "OmniRig property did not return a dispatch object"
                );
                None
            }
            Err(err) => {
                tracing::error!(property_name, "Failed to get OmniRig property: {err}");
                None
            }
        }
    }

    fn current_rig(&self) -> Option<IDispatch> {
        let Some(inner) = self.inner.as_ref() else {
            tracing::error!("OmniRig was used before it was initialized");
            return None;
        };
        Some(inner.rig.clone())
    }

    fn disconnected_status(&self) -> Status {
        Status {
            freq: 0,
            status: "disconnected".into(),
            mode: "unknown".into(),
            current_rig: self.rig_number(),
        }
    }
}

impl Radio for OmnirigRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        let com_guard = if let Some(inner) = std::mem::take(&mut self.inner) {
            inner.com_guard
        } else {
            match CoInitializeEx(co::COINIT::MULTITHREADED | co::COINIT::DISABLE_OLE1DDE) {
                Ok(guard) => guard,
                Err(err) => {
                    tracing::error!("Failed to initialize COM: {err}");
                    self.omnirig_available = false;
                    return Err(RadioInitError::Io {
                        backend: "omnirig",
                        kind: std::io::ErrorKind::Other,
                    });
                }
            }
        };

        let clsid = match CLSIDFromProgID("Omnirig.OmnirigX") {
            Ok(clsid) => clsid,
            Err(err) => {
                tracing::error!("OmniRig is not installed or not registered: {err}");
                self.omnirig_available = false;
                return Err(RadioInitError::Io {
                    backend: "omnirig",
                    kind: std::io::ErrorKind::Other,
                });
            }
        };

        let omnirig = match winsafe::CoCreateInstance::<IDispatch>(
            &clsid,
            None::<&winsafe::IUnknown>,
            co::CLSCTX::LOCAL_SERVER,
        ) {
            Ok(omnirig) => omnirig,
            Err(err) => {
                tracing::error!("Failed to create OmniRig instance: {err}");
                self.omnirig_available = false;
                return Err(RadioInitError::Io {
                    backend: "omnirig",
                    kind: std::io::ErrorKind::Other,
                });
            }
        };

        let property_name = self.property_name();
        let Some(rig) = Self::get_rig_dispatch(&omnirig, property_name) else {
            self.omnirig_available = false;
            return Err(RadioInitError::Io {
                backend: "omnirig",
                kind: std::io::ErrorKind::Other,
            });
        };

        self.inner = Some(OmnirigInner {
            com_guard,
            _omnirig: omnirig,
            rig,
        });
        self.omnirig_available = true;
        Ok(())
    }

    fn set_mode(&mut self, mode: Mode) -> Result<(), RadioOperationError> {
        let mode = match mode {
            Mode::LSB => 0x04000000,
            Mode::USB => 0x02000000,
            Mode::CW => 0x00800000,
            Mode::Data => 0x08000000,
            Mode::Rtty => {
                return Err(RadioOperationError::new(
                    self.rig_number(),
                    "set mode",
                    "OmniRig does not support RTTY mode",
                ));
            }
        };

        let Some(rig) = self.current_rig() else {
            self.omnirig_available = false;
            return Err(RadioOperationError::new(
                self.rig_number(),
                "set mode",
                "OmniRig unavailable",
            ));
        };

        rig.invoke_put("Mode", &winsafe::Variant::I4(mode))
            .map(|_| ())
            .map_err(|error| {
                self.inner = None;
                RadioOperationError::new(self.rig_number(), "set mode", error.to_string())
            })
    }

    fn set_frequency(&mut self, vfo: Slot, freq: Freq) -> Result<(), RadioOperationError> {
        let vfo = match vfo {
            Slot::A => "FreqA",
            Slot::B => "FreqB",
        };
        let freq = freq.as_u32_hz();
        let Some(rig) = self.current_rig() else {
            self.omnirig_available = false;
            return Err(RadioOperationError::new(
                self.rig_number(),
                "set frequency",
                "OmniRig unavailable",
            ));
        };

        rig.invoke_put(vfo, &winsafe::Variant::I4(freq as i32))
            .map(|_| ())
            .map_err(|error| {
                self.inner = None;
                RadioOperationError::new(self.rig_number(), "set frequency", error.to_string())
            })
    }

    fn get_status(&mut self) -> Result<Status, RadioOperationError> {
        let Some(rig) = self.current_rig() else {
            self.omnirig_available = false;
            return Err(RadioOperationError::new(
                self.rig_number(),
                "read status",
                "OmniRig unavailable",
            ));
        };

        let freq = match rig.invoke_get("FreqA", &[]) {
            Ok(winsafe::Variant::I4(freq)) => Freq::from_i32_hz(freq),
            Ok(_) => {
                tracing::error!("OmniRig FreqA did not return an integer");
                return Err(RadioOperationError::new(
                    self.rig_number(),
                    "read frequency",
                    "FreqA did not return an integer",
                ));
            }
            Err(err) => {
                tracing::error!("Failed to get OmniRig frequency: {err}");
                return Err(RadioOperationError::new(
                    self.rig_number(),
                    "read frequency",
                    err.to_string(),
                ));
            }
        };

        let status_str = match rig.invoke_get("StatusStr", &[]) {
            Ok(winsafe::Variant::Bstr(status_str)) => status_str,
            Ok(_) => {
                tracing::error!("OmniRig StatusStr did not return a string");
                return Err(RadioOperationError::new(
                    self.rig_number(),
                    "read status",
                    "StatusStr did not return a string",
                ));
            }
            Err(err) => {
                tracing::error!("Failed to get OmniRig status: {err}");
                return Err(RadioOperationError::new(
                    self.rig_number(),
                    "read status",
                    err.to_string(),
                ));
            }
        };

        if status_str != "On-line" {
            return Err(RadioOperationError::new(
                self.rig_number(),
                "read status",
                status_str,
            ));
        }

        let mode = match rig.invoke_get("Mode", &[]) {
            Ok(winsafe::Variant::I4(mode)) => match mode {
                0x2000000 | 0x4000000 => "SSB",
                0x8000000 | 0x10000000 => "DIGI",
                0x800000 | 0x1000000 => "CW",
                0x20000000 => "AM",
                0x40000000 => "FM",
                _ => "Unknown",
            },
            Ok(_) => {
                tracing::error!("OmniRig Mode did not return an integer");
                return Err(RadioOperationError::new(
                    self.rig_number(),
                    "read mode",
                    "Mode did not return an integer",
                ));
            }
            Err(err) => {
                tracing::error!("Failed to get OmniRig mode: {err}");
                return Err(RadioOperationError::new(
                    self.rig_number(),
                    "read mode",
                    err.to_string(),
                ));
            }
        };

        Ok(Status {
            freq: freq.as_u32_hz(),
            status: "connected".into(),
            mode: mode.into(),
            current_rig: self.rig_number(),
        })
    }
}
