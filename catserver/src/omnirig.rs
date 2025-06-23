use winsafe::guard::CoUninitializeGuard;
use winsafe::prelude::oleaut_IDispatch;
use winsafe::{CLSIDFromProgID, CoInitializeEx, IDispatch, co};

use crate::freq::Freq;
use crate::rig::{Mode, Radio, Slot, Status};

struct OmnirigInner {
    _com_guard: CoUninitializeGuard,
    _omnirig: IDispatch,
    rig1: IDispatch,
    rig2: IDispatch,
}

pub struct OmnirigRadio {
    current_rig: u8,
    inner: Option<OmnirigInner>,
}
unsafe impl Send for OmnirigRadio {}
unsafe impl Sync for OmnirigRadio {}

impl OmnirigRadio {
    pub fn new() -> Self {
        Self {
            current_rig: 1,
            inner: None,
        }
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
        let com_guard =
            CoInitializeEx(co::COINIT::MULTITHREADED | co::COINIT::DISABLE_OLE1DDE).unwrap();

        tracing::debug!("Creating instance");
        let omnirig = winsafe::CoCreateInstance::<IDispatch>(
            &CLSIDFromProgID("Omnirig.OmnirigX").unwrap(),
            None,
            co::CLSCTX::LOCAL_SERVER,
        )
        .unwrap();

        tracing::debug!("Getting rigs");
        let rig1 = omnirig.invoke_get("Rig1", &[]).unwrap().unwrap_dispatch();
        let rig2 = omnirig.invoke_get("Rig2", &[]).unwrap().unwrap_dispatch();

        self.inner = Some(OmnirigInner {
            _com_guard: com_guard,
            _omnirig: omnirig,
            rig1,
            rig2,
        });
    }

    fn get_name(&self) -> &str {
        "omnirig"
    }

    fn set_mode(&mut self, mode: Mode) {
        let mode = match mode {
            Mode::LSB => 0x04000000,
            Mode::USB => 0x02000000,
            Mode::CW => 0x01000000,
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
            "On-line" => "connected",
            "Rig is not responding" => "disconnected",
            _ => "unknown",
        }.to_string();
        Status {
            freq: freq.as_u32_hz(),
            status,
            mode: mode.into(),
            status_str,
            current_rig: self.current_rig,
        }
    }
}
