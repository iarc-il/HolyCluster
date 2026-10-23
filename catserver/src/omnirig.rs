use winsafe::guard::CoUninitializeGuard;
use winsafe::prelude::oleaut_IDispatch;
use winsafe::{CLSIDFromProgID, CoInitializeEx, IDispatch, co};

use crate::freq::Freq;
use crate::radio_config::OmniRigSlot;
use crate::rig::{
    Mode, Radio, RadioBackendContext, RadioInitError, RadioOperationError, Slot, Status,
};

struct OmnirigInner {
    com_guard: CoUninitializeGuard,
    _omnirig: IDispatch,
    rig: IDispatch,
}

pub struct OmnirigRadio {
    slot: OmniRigSlot,
    inner: Option<OmnirigInner>,
}
impl OmnirigRadio {
    pub fn new(slot: OmniRigSlot) -> Self {
        Self { slot, inner: None }
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

    fn get_rig_dispatch(
        omnirig: &IDispatch,
        property_name: &'static str,
    ) -> Result<IDispatch, RadioInitError> {
        let context = context("invoke_get", Some(property_name), true);
        match omnirig.invoke_get(property_name, &[]) {
            Ok(winsafe::Variant::Dispatch(dispatch)) => Ok(dispatch),
            Ok(_) => Err(init_error(
                format!("OmniRig property {property_name} did not return a dispatch object"),
                context,
            )),
            Err(error) => Err(init_error(
                format!("failed to get OmniRig property {property_name}: {error}"),
                native_context(context, error.as_ref()),
            )),
        }
    }

    fn current_rig(&self) -> Option<IDispatch> {
        self.inner.as_ref().map(|inner| inner.rig.clone())
    }
}

fn context(
    operation: &'static str,
    target: Option<&'static str>,
    handle_present: bool,
) -> RadioBackendContext {
    let mut context = RadioBackendContext::new("omnirig", operation, handle_present);
    context.target = target;
    context
}

fn native_context(
    mut context: RadioBackendContext,
    error: &(dyn std::error::Error + 'static),
) -> RadioBackendContext {
    if let Some(code) = error.downcast_ref::<co::HRESULT>() {
        context.hresult = Some(code.raw());
    } else if let Some(exception) = error.downcast_ref::<winsafe::EXCEPINFO>() {
        // WinSafe replaces DISP_E_EXCEPTION with EXCEPINFO at the Invoke boundary.
        context.hresult = Some(co::HRESULT::DISP_E_EXCEPTION.raw());
        context.exception_code = (exception.scode != 0).then_some(exception.scode);
        context.exception_wcode = (exception.wCode != 0).then_some(exception.wCode);
        context.exception_details = Some(serde_json::json!({
            "source": exception.bstrSource(), "description": exception.bstrDescription(),
            "help_file": exception.bstrHelpFile(), "help_context": exception.dwHelpContext,
            "scode": exception.scode, "wcode": exception.wCode,
        }));
    }
    context
}

fn init_error(message: impl Into<String>, context: RadioBackendContext) -> RadioInitError {
    RadioInitError::Com {
        message: message.into(),
        context: Box::new(context),
    }
}

impl Radio for OmnirigRadio {
    fn init(&mut self) -> Result<(), RadioInitError> {
        let com_guard = if let Some(inner) = std::mem::take(&mut self.inner) {
            inner.com_guard
        } else {
            CoInitializeEx(co::COINIT::MULTITHREADED | co::COINIT::DISABLE_OLE1DDE).map_err(
                |error| {
                    init_error(
                        format!("failed to initialize COM: {error}"),
                        native_context(context("CoInitializeEx", None, false), &error),
                    )
                },
            )?
        };

        let clsid = CLSIDFromProgID("Omnirig.OmnirigX").map_err(|error| {
            init_error(
                format!("OmniRig is not installed or registered: {error}"),
                native_context(context("CLSIDFromProgID", None, false), &error),
            )
        })?;

        let omnirig = winsafe::CoCreateInstance::<IDispatch>(
            &clsid,
            None::<&winsafe::IUnknown>,
            co::CLSCTX::LOCAL_SERVER,
        )
        .map_err(|error| {
            init_error(
                format!("failed to create OmniRig instance: {error}"),
                native_context(context("CoCreateInstance", None, false), &error),
            )
        })?;

        let rig = Self::get_rig_dispatch(&omnirig, self.property_name())?;
        self.inner = Some(OmnirigInner {
            com_guard,
            _omnirig: omnirig,
            rig,
        });
        Ok(())
    }

    fn set_mode(&mut self, mode: Mode) -> Result<(), RadioOperationError> {
        let mut context = context("invoke_put", Some("Mode"), self.inner.is_some());
        let (mode, resolved) = crate::omnirig_mode::resolve(mode);
        context.resolved_mode = Some(resolved);
        let Some(rig) = self.current_rig() else {
            return Err(RadioOperationError::new(
                self.rig_number(),
                "set mode",
                "OmniRig unavailable",
            )
            .with_backend_context(context));
        };
        rig.invoke_put("Mode", &winsafe::Variant::I4(mode))
            .map(|_| ())
            .map_err(|error| {
                self.inner = None;
                RadioOperationError::new(self.rig_number(), "set mode", error.to_string())
                    .with_backend_context(native_context(context, error.as_ref()))
            })
    }

    fn set_frequency(&mut self, vfo: Slot, freq: Freq) -> Result<(), RadioOperationError> {
        let vfo = match vfo {
            Slot::A => "FreqA",
            Slot::B => "FreqB",
        };
        let mut context = context("invoke_put", Some(vfo), self.inner.is_some());
        let freq = freq.as_u32_hz();
        context.resolved_frequency_hz = Some(freq);
        let Some(rig) = self.current_rig() else {
            return Err(RadioOperationError::new(
                self.rig_number(),
                "set frequency",
                "OmniRig unavailable",
            )
            .with_backend_context(context));
        };
        rig.invoke_put(vfo, &winsafe::Variant::I4(freq as i32))
            .map(|_| ())
            .map_err(|error| {
                self.inner = None;
                RadioOperationError::new(self.rig_number(), "set frequency", error.to_string())
                    .with_backend_context(native_context(context, error.as_ref()))
            })
    }

    fn get_status(&mut self) -> Result<Status, RadioOperationError> {
        let Some(rig) = self.current_rig() else {
            return Err(RadioOperationError::new(
                self.rig_number(),
                "read status",
                "OmniRig unavailable",
            )
            .with_backend_context(context("invoke_get", Some("FreqA"), false)));
        };

        let freq = match rig.invoke_get("FreqA", &[]) {
            Ok(winsafe::Variant::I4(freq)) => Freq::from_i32_hz(freq),
            Ok(_) => {
                return Err(RadioOperationError::new(
                    self.rig_number(),
                    "read frequency",
                    "FreqA did not return an integer",
                )
                .with_backend_context(context("invoke_get", Some("FreqA"), true)));
            }
            Err(error) => {
                return Err(RadioOperationError::new(
                    self.rig_number(),
                    "read frequency",
                    error.to_string(),
                )
                .with_backend_context(native_context(
                    context("invoke_get", Some("FreqA"), true),
                    error.as_ref(),
                )));
            }
        };

        let status_str = match rig.invoke_get("StatusStr", &[]) {
            Ok(winsafe::Variant::Bstr(status_str)) => status_str,
            Ok(_) => {
                return Err(RadioOperationError::new(
                    self.rig_number(),
                    "read status",
                    "StatusStr did not return a string",
                )
                .with_backend_context(context(
                    "invoke_get",
                    Some("StatusStr"),
                    true,
                )));
            }
            Err(error) => {
                return Err(RadioOperationError::new(
                    self.rig_number(),
                    "read status",
                    error.to_string(),
                )
                .with_backend_context(native_context(
                    context("invoke_get", Some("StatusStr"), true),
                    error.as_ref(),
                )));
            }
        };

        if status_str != "On-line" {
            return Err(
                RadioOperationError::new(self.rig_number(), "read status", status_str)
                    .with_backend_context(context("invoke_get", Some("StatusStr"), true)),
            );
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
                tracing::debug!("OmniRig Mode did not return an integer");
                "Unknown"
            }
            Err(error) => {
                tracing::debug!(%error, "Failed to get OmniRig mode");
                "Unknown"
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_com_context_preserves_hresult_and_exception_domains() {
        let code = co::HRESULT::E_INVALIDARG;
        let context = native_context(context("CoInitializeEx", None, false), &code);
        assert_eq!(context.hresult, Some(code.raw()));
        assert_eq!(context.operation, "CoInitializeEx");
        let mut exception = winsafe::EXCEPINFO::default();
        exception.scode = -123;
        exception.wCode = 42;
        let context = native_context(super::context("invoke_put", Some("Mode"), true), &exception);
        assert_eq!(context.hresult, Some(co::HRESULT::DISP_E_EXCEPTION.raw()));
        assert_eq!(context.exception_code, Some(-123));
        assert_eq!(context.exception_wcode, Some(42));
        let unknown = std::io::Error::other("[0x80070057] not a COM error");
        let context = native_context(
            super::context("invoke_get", Some("StatusStr"), true),
            &unknown,
        );
        assert_eq!(context.hresult, None);
    }

    #[test]
    fn missing_dispatch_preserves_resolved_mode() {
        let mut radio = OmnirigRadio::new(OmniRigSlot::Rig2);
        let error = radio.set_mode(Mode::Rtty).unwrap_err();
        assert_eq!(error.rig, 2);
        let context = error.backend_context.unwrap();
        assert_eq!(context.operation, "invoke_put");
        assert_eq!(context.target, Some("Mode"));
        assert_eq!(context.resolved_mode, Some("DIG_L"));
        assert!(!context.handle_present);
        assert!(context.hresult.is_none());
    }
}
