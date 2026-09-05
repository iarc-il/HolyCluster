#![allow(unsafe_code)]

use std::{ffi::CString, marker::PhantomData, ptr::NonNull, rc::Rc};

use hamlib_sys as sys;

use crate::{
    ConfigDescriptor, ConfigValue, ConfigurationError, HamlibError, RigControlError, RigModelId,
    ffi,
};

/// ```compile_fail
/// use hamlib::{Closed, Rig, Vfo};
/// let mut rig: Rig<Closed> = todo!();
/// rig.frequency(Vfo::A);
/// ```
pub struct Closed;
pub struct Open;

pub struct Rig<State> {
    handle: NonNull<sys::RIG>,
    model: RigModelId,
    open: bool,
    owned: bool,
    state: PhantomData<State>,
    not_send_or_sync: PhantomData<Rc<()>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Vfo {
    A,
    B,
    Current,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Mode {
    Am,
    Cw,
    Usb,
    Lsb,
    Fm,
    PktUsb,
    PktLsb,
    Rtty,
    RttyR,
    Unknown(sys::rmode_t),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frequency(f64);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PassbandWidth(sys::pbwidth_t);

impl Frequency {
    pub fn new(value: f64) -> Result<Self, RigControlError> {
        if value.is_finite() && value >= 0.0 {
            Ok(Self(value))
        } else {
            Err(RigControlError::InvalidFrequency)
        }
    }

    pub const fn hertz(self) -> f64 {
        self.0
    }
}

impl PassbandWidth {
    pub const fn new(value: sys::pbwidth_t) -> Self {
        Self(value)
    }

    pub const fn hertz(self) -> sys::pbwidth_t {
        self.0
    }
}

impl Rig<Closed> {
    pub fn new(model: RigModelId) -> Result<Self, HamlibError> {
        ffi::load_backends()?;
        // SAFETY: Hamlib's initialized backend registry owns model lookup and returns an owned handle.
        let handle = unsafe { sys::rig_init(model.get()) };
        let handle = NonNull::new(handle).ok_or(HamlibError::NullHandle {
            operation: "rig_init",
            model,
        })?;
        Ok(Self::from_handle(handle, model, false))
    }

    pub fn configure(
        &mut self,
        descriptor: &ConfigDescriptor,
        value: &ConfigValue,
    ) -> Result<(), ConfigurationError> {
        descriptor.validate(value)?;
        let name = CString::new(descriptor.token().as_str()).map_err(|_| {
            ConfigurationError::UnknownToken {
                model: self.model,
                token: descriptor.token().as_str().to_owned(),
            }
        })?;
        // SAFETY: `handle` is exclusively owned and `name` stays valid for the synchronous lookup.
        let parameter = unsafe { sys::rig_confparam_lookup(self.handle.as_ptr(), name.as_ptr()) };
        if parameter.is_null() {
            return Err(ConfigurationError::UnknownToken {
                model: self.model,
                token: descriptor.token().as_str().to_owned(),
            });
        }
        // SAFETY: the descriptor lookup above returned a live configuration parameter.
        let token = unsafe { (*parameter).token };
        let value =
            CString::new(value.encoded()).map_err(|_| ConfigurationError::UnknownToken {
                model: self.model,
                token: descriptor.token().as_str().to_owned(),
            })?;
        // SAFETY: `handle` is exclusively owned and `value` stays valid for the synchronous call.
        ffi::hamlib_result("rig_set_conf", unsafe {
            sys::rig_set_conf(self.handle.as_ptr(), token, value.as_ptr())
        })?;
        Ok(())
    }

    pub fn open(mut self) -> Result<Rig<Open>, HamlibError> {
        // SAFETY: `handle` is exclusively owned and unopened by this type state.
        ffi::hamlib_result("rig_open", unsafe { sys::rig_open(self.handle.as_ptr()) })?;
        self.open = true;
        Ok(self.into_state(true))
    }
}

impl Rig<Open> {
    pub fn frequency(&mut self, vfo: Vfo) -> Result<Frequency, RigControlError> {
        let mut frequency = 0.0;
        // SAFETY: `handle` is exclusively owned and the output pointer is valid for this call.
        ffi::hamlib_result("rig_get_freq", unsafe {
            sys::rig_get_freq(self.handle.as_ptr(), vfo.raw(), &mut frequency)
        })?;
        Frequency::new(frequency)
    }

    pub fn set_frequency(&mut self, vfo: Vfo, frequency: Frequency) -> Result<(), HamlibError> {
        // SAFETY: `handle` is exclusively owned and all arguments are Rust-owned values.
        ffi::hamlib_result("rig_set_freq", unsafe {
            sys::rig_set_freq(self.handle.as_ptr(), vfo.raw(), frequency.hertz())
        })
    }

    pub fn mode(&mut self, vfo: Vfo) -> Result<(Mode, PassbandWidth), RigControlError> {
        let mut mode = sys::RIG_MODE_NONE.into();
        let mut width = 0;
        // SAFETY: `handle` is exclusively owned and both output pointers are valid for this call.
        ffi::hamlib_result("rig_get_mode", unsafe {
            sys::rig_get_mode(self.handle.as_ptr(), vfo.raw(), &mut mode, &mut width)
        })?;
        Ok((Mode::from_raw(mode), PassbandWidth::new(width)))
    }

    pub fn set_mode(
        &mut self,
        vfo: Vfo,
        mode: Mode,
        width: PassbandWidth,
    ) -> Result<(), HamlibError> {
        // SAFETY: `handle` is exclusively owned and all arguments are Rust-owned values.
        ffi::hamlib_result("rig_set_mode", unsafe {
            sys::rig_set_mode(self.handle.as_ptr(), vfo.raw(), mode.raw(), width.hertz())
        })
    }

    pub fn vfo(&mut self) -> Result<Vfo, RigControlError> {
        let mut vfo = sys::RIG_VFO_NONE;
        // SAFETY: `handle` is exclusively owned and the output pointer is valid for this call.
        ffi::hamlib_result("rig_get_vfo", unsafe {
            sys::rig_get_vfo(self.handle.as_ptr(), &mut vfo)
        })?;
        Vfo::from_raw(vfo)
    }

    pub fn set_vfo(&mut self, vfo: Vfo) -> Result<(), HamlibError> {
        // SAFETY: `handle` is exclusively owned and the VFO is a Rust enum conversion.
        ffi::hamlib_result("rig_set_vfo", unsafe {
            sys::rig_set_vfo(self.handle.as_ptr(), vfo.raw())
        })
    }

    pub fn close(mut self) -> Result<Rig<Closed>, HamlibError> {
        // SAFETY: `handle` is exclusively owned and open in this type state.
        ffi::hamlib_result("rig_close", unsafe { sys::rig_close(self.handle.as_ptr()) })?;
        self.open = false;
        Ok(self.into_state(false))
    }
}

impl<State> Rig<State> {
    fn from_handle(handle: NonNull<sys::RIG>, model: RigModelId, open: bool) -> Self {
        Self {
            handle,
            model,
            open,
            owned: true,
            state: PhantomData,
            not_send_or_sync: PhantomData,
        }
    }

    fn into_state<Next>(mut self, open: bool) -> Rig<Next> {
        self.owned = false;
        Rig::from_handle(self.handle, self.model, open)
    }
}

impl<State> Drop for Rig<State> {
    fn drop(&mut self) {
        if self.owned {
            if self.open {
                // SAFETY: this owner closes the handle before releasing it.
                let _ = unsafe { sys::rig_close(self.handle.as_ptr()) };
            }
            // SAFETY: this owner releases the handle exactly once.
            let _ = unsafe { sys::rig_cleanup(self.handle.as_ptr()) };
        }
    }
}

impl Vfo {
    fn raw(self) -> sys::vfo_t {
        match self {
            Self::A => sys::HAMLIB_SYS_RIG_VFO_A,
            Self::B => sys::HAMLIB_SYS_RIG_VFO_B,
            Self::Current => sys::HAMLIB_SYS_RIG_VFO_CURR,
        }
    }

    fn from_raw(value: sys::vfo_t) -> Result<Self, RigControlError> {
        match value {
            sys::HAMLIB_SYS_RIG_VFO_A => Ok(Self::A),
            sys::HAMLIB_SYS_RIG_VFO_B => Ok(Self::B),
            sys::HAMLIB_SYS_RIG_VFO_CURR => Ok(Self::Current),
            value => Err(RigControlError::UnknownVfo(value)),
        }
    }
}

impl Mode {
    fn raw(self) -> sys::rmode_t {
        match self {
            Self::Am => sys::HAMLIB_SYS_RIG_MODE_AM.into(),
            Self::Cw => sys::HAMLIB_SYS_RIG_MODE_CW.into(),
            Self::Usb => sys::HAMLIB_SYS_RIG_MODE_USB.into(),
            Self::Lsb => sys::HAMLIB_SYS_RIG_MODE_LSB.into(),
            Self::Fm => sys::HAMLIB_SYS_RIG_MODE_FM.into(),
            Self::PktUsb => sys::HAMLIB_SYS_RIG_MODE_PKTUSB.into(),
            Self::PktLsb => sys::HAMLIB_SYS_RIG_MODE_PKTLSB.into(),
            Self::Rtty => sys::HAMLIB_SYS_RIG_MODE_RTTY.into(),
            Self::RttyR => sys::HAMLIB_SYS_RIG_MODE_RTTYR.into(),
            Self::Unknown(value) => value,
        }
    }

    fn from_raw(value: sys::rmode_t) -> Self {
        match value {
            value if value == sys::HAMLIB_SYS_RIG_MODE_AM.into() => Self::Am,
            value if value == sys::HAMLIB_SYS_RIG_MODE_CW.into() => Self::Cw,
            value if value == sys::HAMLIB_SYS_RIG_MODE_USB.into() => Self::Usb,
            value if value == sys::HAMLIB_SYS_RIG_MODE_LSB.into() => Self::Lsb,
            value if value == sys::HAMLIB_SYS_RIG_MODE_FM.into() => Self::Fm,
            value if value == sys::HAMLIB_SYS_RIG_MODE_PKTUSB.into() => Self::PktUsb,
            value if value == sys::HAMLIB_SYS_RIG_MODE_PKTLSB.into() => Self::PktLsb,
            value if value == sys::HAMLIB_SYS_RIG_MODE_RTTY.into() => Self::Rtty,
            value if value == sys::HAMLIB_SYS_RIG_MODE_RTTYR.into() => Self::RttyR,
            value => Self::Unknown(value),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generic_digital_and_rtty_modes_convert_to_and_from_raw_values() {
        for (mode, raw, expected) in [
            (
                Mode::PktUsb,
                sys::HAMLIB_SYS_RIG_MODE_PKTUSB.into(),
                1_u64 << 11,
            ),
            (
                Mode::PktLsb,
                sys::HAMLIB_SYS_RIG_MODE_PKTLSB.into(),
                1_u64 << 10,
            ),
            (Mode::Rtty, sys::HAMLIB_SYS_RIG_MODE_RTTY.into(), 1_u64 << 4),
            (
                Mode::RttyR,
                sys::HAMLIB_SYS_RIG_MODE_RTTYR.into(),
                1_u64 << 8,
            ),
        ] {
            assert_eq!(raw, expected);
            assert_eq!(mode.raw(), raw);
            assert_eq!(Mode::from_raw(raw), mode);
        }
    }

    #[test]
    fn unknown_mode_preserves_raw_value() {
        let raw = 1_u64 << 63;
        assert_eq!(Mode::from_raw(raw), Mode::Unknown(raw));
        assert_eq!(Mode::Unknown(raw).raw(), raw);
    }

    #[test]
    fn mode_propagates_hamlib_error_from_unopened_fixture() {
        let closed = Rig::new(RigModelId::DUMMY).expect("dummy handle initializes");
        let mut open: Rig<Open> = closed.into_state(true);
        let error = open.mode(Vfo::A).expect_err("unopened fixture must fail");
        assert!(matches!(
            error,
            RigControlError::Hamlib(HamlibError::Call {
                operation: "rig_get_mode",
                code: -1,
                ..
            })
        ));
    }
}
