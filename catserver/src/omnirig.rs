use winsafe::guard::CoUninitializeGuard;
use winsafe::prelude::oleaut_IDispatch;
use winsafe::{CLSIDFromProgID, CoInitializeEx, IDispatch, co};

use crate::rig::{Mode, Radio, Rig, Status};

struct OmnirigInner {
    com_guard: CoUninitializeGuard,
    omnirig: IDispatch,
    rig1: IDispatch,
    rig2: IDispatch,
}

pub struct OmnirigRadio {
    current_rig: Rig,
    inner: Option<OmnirigInner>,
}
unsafe impl Send for OmnirigRadio {}
unsafe impl Sync for OmnirigRadio {}

impl OmnirigRadio {
    pub fn new() -> Self {
        Self {
            current_rig: Rig::A,
            inner: None,
        }
    }

    fn inner(&self) -> &OmnirigInner {
        self.inner.as_ref().unwrap()
    }
}

impl Radio for OmnirigRadio {
    fn init(&mut self) {
        let com_guard =
            CoInitializeEx(co::COINIT::MULTITHREADED | co::COINIT::DISABLE_OLE1DDE).unwrap();

        let omnirig = winsafe::CoCreateInstance::<IDispatch>(
            &CLSIDFromProgID("Omnirig.OmnirigX").unwrap(),
            None,
            co::CLSCTX::LOCAL_SERVER,
        )
        .unwrap();

        let rig1 = omnirig.invoke_get("Rig1", &[]).unwrap().unwrap_dispatch();
        let rig2 = omnirig.invoke_get("Rig1", &[]).unwrap().unwrap_dispatch();

        self.inner = Some(OmnirigInner {
            com_guard,
            omnirig,
            rig1,
            rig2,
        });
    }

    fn set_mode(&mut self, mode: Mode) {}

    fn set_rig(&mut self, rig: Rig) {}

    fn set_frequency(&mut self, mut rig: Rig, freq: u32) {
        println!("Setting freq at {rig:?} to {freq}");
        if rig == Rig::Current {
            rig = self.current_rig;
        }
        let rig_name = match rig {
            Rig::A => "FreqA",
            Rig::B => "FreqB",
            Rig::Current => panic!(),
        };
        let _ = self
            .inner()
            .rig1
            .invoke_put(rig_name, &winsafe::Variant::I4(freq as i32 * 1000));
    }

    fn get_status(&mut self) -> Status {
        Status {
            freq: 0,
            status: "connected".into(),
            status_str: "".into(),
            current_rig: Rig::A,
        }
    }
}
