use winsafe::guard::CoUninitializeGuard;
use winsafe::prelude::oleaut_IDispatch;
use winsafe::{CLSIDFromProgID, CoInitializeEx, IDispatch, co};

use crate::freq::Freq;
use crate::rig::{Mode, Radio, Slot, Status};

struct OmnirigInner {
    com_guard: CoUninitializeGuard,
    _omnirig: IDispatch,
    rig1: IDispatch,
    rig2: IDispatch,
}

pub struct OmnirigRadio {
    current_rig: u8,
    inner: Option<OmnirigInner>,
    reconnect_counter: u8,
    omnirig_available: bool,
}
unsafe impl Send for OmnirigRadio {}
unsafe impl Sync for OmnirigRadio {}

impl OmnirigRadio {
    pub fn new() -> Self {
        Self {
            current_rig: 1,
            inner: None,
            reconnect_counter: 0,
            omnirig_available: false,
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

        match self.current_rig {
            1 => Some(inner.rig1.clone()),
            2 => Some(inner.rig2.clone()),
            rig => {
                tracing::error!(rig, "Invalid OmniRig rig selected");
                None
            }
        }
    }

    fn disconnected_status(&self) -> Status {
        Status {
            freq: 0,
            status: "disconnected".into(),
            mode: "unknown".into(),
            current_rig: self.current_rig,
        }
    }

    fn record_connection_failure(&mut self) {
        self.reconnect_counter = self.reconnect_counter.saturating_add(1);
        if self.reconnect_counter >= 5 {
            self.reconnect_counter = 0;
            self.init();
        }
    }
}

impl Radio for OmnirigRadio {
    fn init(&mut self) {
        let com_guard = if let Some(inner) = std::mem::take(&mut self.inner) {
            inner.com_guard
        } else {
            match CoInitializeEx(co::COINIT::MULTITHREADED | co::COINIT::DISABLE_OLE1DDE) {
                Ok(guard) => guard,
                Err(err) => {
                    tracing::error!("Failed to initialize COM: {err}");
                    self.omnirig_available = false;
                    return;
                }
            }
        };

        let clsid = match CLSIDFromProgID("Omnirig.OmnirigX") {
            Ok(clsid) => clsid,
            Err(err) => {
                tracing::error!("OmniRig is not installed or not registered: {err}");
                self.omnirig_available = false;
                return;
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
                return;
            }
        };

        let Some(rig1) = Self::get_rig_dispatch(&omnirig, "Rig1") else {
            self.omnirig_available = false;
            return;
        };
        let Some(rig2) = Self::get_rig_dispatch(&omnirig, "Rig2") else {
            self.omnirig_available = false;
            return;
        };

        self.inner = Some(OmnirigInner {
            com_guard,
            _omnirig: omnirig,
            rig1,
            rig2,
        });
        self.omnirig_available = true;
    }

    fn get_name(&self) -> &str {
        "omnirig"
    }

    fn set_mode(&mut self, mode: Mode) {
        let mode = match mode {
            Mode::LSB => 0x04000000,
            Mode::USB => 0x02000000,
            Mode::CW => 0x00800000,
            Mode::Data => 0x08000000,
        };

        let Some(rig) = self.current_rig() else {
            self.omnirig_available = false;
            return;
        };

        if let Err(err) = rig.invoke_put("Mode", &winsafe::Variant::I4(mode)) {
            tracing::error!("Failed to set OmniRig mode: {err}");
            self.record_connection_failure();
        }
    }

    fn set_rig(&mut self, rig: u8) {
        if rig != 1 && rig != 2 {
            tracing::error!(rig, "Ignoring invalid OmniRig rig");
            return;
        }
        self.current_rig = rig;
    }

    fn set_frequency(&mut self, vfo: Slot, freq: Freq) {
        let vfo = match vfo {
            Slot::A => "FreqA",
            Slot::B => "FreqB",
        };
        let freq = freq.as_u32_hz();
        let Some(rig) = self.current_rig() else {
            self.omnirig_available = false;
            return;
        };

        if let Err(err) = rig.invoke_put(vfo, &winsafe::Variant::I4(freq as i32)) {
            tracing::error!(vfo, "Failed to set OmniRig frequency: {err}");
            self.record_connection_failure();
        }
    }

    fn get_status(&mut self) -> Status {
        let Some(rig) = self.current_rig() else {
            self.omnirig_available = false;
            return self.disconnected_status();
        };

        let freq = match rig.invoke_get("FreqA", &[]) {
            Ok(winsafe::Variant::I4(freq)) => Freq::from_i32_hz(freq),
            Ok(_) => {
                tracing::error!("OmniRig FreqA did not return an integer");
                self.record_connection_failure();
                return self.disconnected_status();
            }
            Err(err) => {
                tracing::error!("Failed to get OmniRig frequency: {err}");
                self.record_connection_failure();
                return self.disconnected_status();
            }
        };

        let status_str = match rig.invoke_get("StatusStr", &[]) {
            Ok(winsafe::Variant::Bstr(status_str)) => status_str,
            Ok(_) => {
                tracing::error!("OmniRig StatusStr did not return a string");
                "unknown".into()
            }
            Err(err) => {
                tracing::error!("Failed to get OmniRig status: {err}");
                self.record_connection_failure();
                return self.disconnected_status();
            }
        };

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
                "Unknown"
            }
            Err(err) => {
                tracing::error!("Failed to get OmniRig mode: {err}");
                "Unknown"
            }
        };

        let status = match status_str.as_str() {
            "On-line" => {
                self.reconnect_counter = 0;
                "connected"
            }
            "Rig is not responding" => {
                self.record_connection_failure();
                "disconnected"
            }
            "Port is not available" => "disconnected",
            _ => "unknown",
        }
        .to_string();
        Status {
            freq: freq.as_u32_hz(),
            status,
            mode: mode.into(),
            current_rig: self.current_rig,
        }
    }

    fn is_available(&self) -> bool {
        self.omnirig_available
    }
}
