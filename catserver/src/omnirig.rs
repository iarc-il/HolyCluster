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

    pub fn is_omnirig_available(&self) -> bool {
        self.omnirig_available
    }

    fn inner(&self) -> &OmnirigInner {
        self.inner.as_ref().unwrap()
    }

    fn current_rig(&self) -> &'_ IDispatch {
        match self.current_rig {
            1 => &self.inner().rig1,
            2 => &self.inner().rig2,
            _ => panic!(),
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

        let rig1 = omnirig.invoke_get("Rig1", &[]).unwrap().unwrap_dispatch();
        let rig2 = omnirig.invoke_get("Rig2", &[]).unwrap().unwrap_dispatch();

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

        self.current_rig()
            .invoke_put("Mode", &winsafe::Variant::I4(mode))
            .unwrap();
    }

    fn set_rig(&mut self, rig: u8) {
        if rig != 1 && rig != 2 {
            panic!("Invalid rig: {rig}");
        }
        self.current_rig = rig;
    }

    fn set_frequency(&mut self, vfo: Slot, freq: Freq) {
        let vfo = match vfo {
            Slot::A => "FreqA",
            Slot::B => "FreqB",
        };
        let freq = freq.as_u32_hz();
        self.current_rig()
            .invoke_put(vfo, &winsafe::Variant::I4(freq as i32))
            .unwrap();
    }

    fn get_status(&mut self) -> Status {
        let freq = self.current_rig().invoke_get("FreqA", &[]).unwrap();
        let freq = if let winsafe::Variant::I4(freq) = freq {
            Freq::from_i32_hz(freq)
        } else {
            panic!("Unknown variant");
        };
        let status_str = self
            .current_rig()
            .invoke_get("StatusStr", &[])
            .unwrap()
            .unwrap_bstr();
        let mode = self.current_rig().invoke_get("Mode", &[]).unwrap();

        let mode = if let winsafe::Variant::I4(mode) = mode {
            match mode {
                0x2000000 | 0x4000000 => "SSB",
                0x8000000 | 0x10000000 => "DIGI",
                0x800000 | 0x1000000 => "CW",
                0x20000000 => "AM",
                0x40000000 => "FM",
                _ => "Unknown",
            }
        } else {
            panic!("Unknown variant");
        };

        let status = match status_str.as_str() {
            "On-line" => {
                self.reconnect_counter = 0;
                "connected"
            }
            "Rig is not responding" => {
                self.reconnect_counter += 1;
                "disconnected"
            }
            "Port is not available" => "disconnected",
            _ => "unknown",
        }
        .to_string();

        if self.reconnect_counter == 5 {
            self.reconnect_counter = 0;
            self.init();
        }
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
