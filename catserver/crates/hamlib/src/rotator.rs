#![allow(unsafe_code)]

use std::{ffi::CString, marker::PhantomData, ptr::NonNull, rc::Rc};
use hamlib_sys as sys;
use crate::{ConfigDescriptor, ConfigValue, HamlibError, RigModelId, ffi};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RotatorModel { id: RigModelId, manufacturer: String, model: String, version: String }
impl RotatorModel { pub const fn id(&self) -> RigModelId { self.id } pub fn manufacturer(&self) -> &str { &self.manufacturer } pub fn model(&self) -> &str { &self.model } pub fn version(&self) -> &str { &self.version } }

#[derive(Clone, Debug)]
pub struct RotatorCatalog { models: Vec<RotatorModel> }
impl RotatorCatalog {
    pub fn load() -> Result<Self, HamlibError> { ffi::load_backends()?; let mut ids = Vec::new(); unsafe extern "C" fn callback(caps: *const sys::rot_caps, data: *mut std::ffi::c_void) -> i32 { if caps.is_null() { return 0; } let metadata = unsafe { sys::hamlib_sys_rot_caps_metadata(caps) }; if metadata.is_null() { return 0; } unsafe { (&mut *(data as *mut Vec<RigModelId>)).push(RigModelId::new((*metadata).rot_model as u32)); } 1 } let result = unsafe { sys::rot_list_foreach(Some(callback), (&mut ids as *mut Vec<RigModelId>).cast()) }; ffi::hamlib_result("rot_list_foreach", result)?; Ok(Self { models: ids.into_iter().map(|id| RotatorModel { id, manufacturer: String::new(), model: String::new(), version: String::new() }).collect() }) }
    pub fn models(&self) -> &[RotatorModel] { &self.models }
    pub fn model(&self, id: RigModelId) -> Option<&RotatorModel> { self.models.iter().find(|model| model.id == id) }
}

pub struct RotatorClosed;
pub struct RotatorOpen;

pub struct Rotator<S> {
    handle: NonNull<sys::ROT>, model: RigModelId, open: bool,
    owned: bool, state: PhantomData<S>, not_send_or_sync: PhantomData<Rc<()>>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Position { pub azimuth: f64, pub elevation: f64 }

impl Position {
    pub fn new(azimuth: f64, elevation: f64) -> Result<Self, HamlibError> {
        if azimuth.is_finite() && elevation.is_finite() && (0.0..=360.0).contains(&azimuth) && (-90.0..=90.0).contains(&elevation) { Ok(Self { azimuth, elevation }) } else { Err(HamlibError::InvalidPosition) }
    }
}

impl Rotator<RotatorClosed> {
    pub fn new(model: RigModelId) -> Result<Self, HamlibError> {
        ffi::load_backends()?;
        let handle = NonNull::new(unsafe { sys::rot_init(model.get()) }).ok_or(HamlibError::NullHandle { operation: "rot_init", model })?;
        Ok(Self { handle, model, open: false, owned: true, state: PhantomData, not_send_or_sync: PhantomData })
    }
    pub fn configure(&mut self, descriptor: &ConfigDescriptor, value: &ConfigValue) -> Result<(), HamlibError> {
        descriptor.validate(value).map_err(|_| HamlibError::InvalidConfiguration)?;
        let name = CString::new(descriptor.token().as_str()).map_err(|_| HamlibError::InvalidConfiguration)?;
        let parameter = unsafe { sys::rot_confparam_lookup(self.handle.as_ptr(), name.as_ptr()) };
        if parameter.is_null() { return Err(HamlibError::InvalidConfiguration); }
        let value = CString::new(value.encoded()).map_err(|_| HamlibError::InvalidConfiguration)?;
        ffi::hamlib_result("rot_set_conf", unsafe { sys::rot_set_conf(self.handle.as_ptr(), (*parameter).token, value.as_ptr()) })
    }
    pub fn open(mut self) -> Result<Rotator<RotatorOpen>, HamlibError> {
        ffi::hamlib_result("rot_open", unsafe { sys::rot_open(self.handle.as_ptr()) })?;
        self.open = true; self.owned = false;
        Ok(Rotator { handle: self.handle, model: self.model, open: true, owned: true, state: PhantomData, not_send_or_sync: PhantomData })
    }
}

impl Rotator<RotatorOpen> {
    pub fn position(&mut self) -> Result<Position, HamlibError> { let (mut a, mut e) = (0.0, 0.0); ffi::hamlib_result("rot_get_position", unsafe { sys::rot_get_position(self.handle.as_ptr(), &mut a, &mut e) })?; Position::new(a, e) }
    pub fn set_position(&mut self, position: Position) -> Result<(), HamlibError> { ffi::hamlib_result("rot_set_position", unsafe { sys::rot_set_position(self.handle.as_ptr(), position.azimuth, position.elevation) }) }
    pub fn close(mut self) -> Result<Rotator<RotatorClosed>, HamlibError> { ffi::hamlib_result("rot_close", unsafe { sys::rot_close(self.handle.as_ptr()) })?; self.open = false; self.owned = false; Ok(Rotator { handle: self.handle, model: self.model, open: false, owned: true, state: PhantomData, not_send_or_sync: PhantomData }) }
}

impl<S> Drop for Rotator<S> { fn drop(&mut self) { if self.owned { if self.open { let _ = unsafe { sys::rot_close(self.handle.as_ptr()) }; } let _ = unsafe { sys::rot_cleanup(self.handle.as_ptr()) }; } } }
