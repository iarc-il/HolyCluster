#![allow(unsafe_code)]

use crate::{
    CatalogError, ConfigDescriptor, ConfigValue, HamlibError, RigModelStatus, RigPortType,
    RotatorModelId, ffi,
};
use hamlib_sys as sys;
use std::{ffi::CString, marker::PhantomData, ops::RangeInclusive, ptr::NonNull, rc::Rc};

#[derive(Clone, Debug, PartialEq)]
pub struct RotatorModel {
    pub(crate) id: RotatorModelId,
    pub(crate) manufacturer: String,
    pub(crate) model: String,
    pub(crate) version: String,
    pub(crate) status: RigModelStatus,
    pub(crate) port_type: RigPortType,
    pub(crate) minimum_azimuth: f64,
    pub(crate) maximum_azimuth: f64,
    pub(crate) can_get_position: bool,
    pub(crate) can_set_position: bool,
}
impl RotatorModel {
    pub const fn id(&self) -> RotatorModelId {
        self.id
    }
    pub fn manufacturer(&self) -> &str {
        &self.manufacturer
    }
    pub fn model(&self) -> &str {
        &self.model
    }
    pub fn version(&self) -> &str {
        &self.version
    }
    pub const fn status(&self) -> RigModelStatus {
        self.status
    }
    pub const fn port_type(&self) -> RigPortType {
        self.port_type
    }
    pub fn azimuth_range(&self) -> RangeInclusive<f64> {
        self.minimum_azimuth..=self.maximum_azimuth
    }
    pub const fn can_get_position(&self) -> bool {
        self.can_get_position
    }
    pub const fn can_set_position(&self) -> bool {
        self.can_set_position
    }
}

#[derive(Clone, Debug)]
pub struct RotatorCatalog {
    models: Vec<RotatorModel>,
}
impl RotatorCatalog {
    pub fn load() -> Result<Self, CatalogError> {
        Ok(Self {
            models: ffi::rotator_models()?,
        })
    }
    pub fn models(&self) -> &[RotatorModel] {
        &self.models
    }
    pub fn model(&self, id: RotatorModelId) -> Option<&RotatorModel> {
        self.models.iter().find(|model| model.id == id)
    }
    pub fn describe_model(
        &self,
        id: RotatorModelId,
    ) -> Result<Vec<ConfigDescriptor>, CatalogError> {
        if self.model(id).is_none() {
            return Err(CatalogError::UnknownRotatorModel { model: id });
        }
        ffi::rotator_descriptors(id)
    }
}

pub struct RotatorClosed;
pub struct RotatorOpen;

pub struct Rotator<S> {
    handle: NonNull<sys::ROT>,
    model: RotatorModelId,
    open: bool,
    owned: bool,
    state: PhantomData<S>,
    not_send_or_sync: PhantomData<Rc<()>>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Position {
    pub azimuth: f64,
    pub elevation: f64,
}

impl Position {
    pub fn new(azimuth: f64, elevation: f64) -> Result<Self, HamlibError> {
        if azimuth.is_finite()
            && elevation.is_finite()
            && (0.0..=360.0).contains(&azimuth)
            && (-90.0..=90.0).contains(&elevation)
        {
            Ok(Self { azimuth, elevation })
        } else {
            Err(HamlibError::InvalidPosition)
        }
    }
}

impl Rotator<RotatorClosed> {
    pub fn new(model: RotatorModelId) -> Result<Self, HamlibError> {
        ffi::load_rotator_backends()?;
        let handle =
            NonNull::new(unsafe { sys::rot_init(model.get()) }).ok_or(
                HamlibError::NullRotatorHandle {
                    operation: "rot_init",
                    model,
                },
            )?;
        Ok(Self {
            handle,
            model,
            open: false,
            owned: true,
            state: PhantomData,
            not_send_or_sync: PhantomData,
        })
    }
    pub fn configure(
        &mut self,
        descriptor: &ConfigDescriptor,
        value: &ConfigValue,
    ) -> Result<(), HamlibError> {
        descriptor
            .validate(value)
            .map_err(|_| HamlibError::InvalidConfiguration)?;
        let name = CString::new(descriptor.token().as_str())
            .map_err(|_| HamlibError::InvalidConfiguration)?;
        let parameter = unsafe { sys::rot_confparam_lookup(self.handle.as_ptr(), name.as_ptr()) };
        if parameter.is_null() {
            return Err(HamlibError::InvalidConfiguration);
        }
        let value = CString::new(value.encoded()).map_err(|_| HamlibError::InvalidConfiguration)?;
        ffi::hamlib_result("rot_set_conf", unsafe {
            sys::rot_set_conf(self.handle.as_ptr(), (*parameter).token, value.as_ptr())
        })
    }
    pub fn open(mut self) -> Result<Rotator<RotatorOpen>, HamlibError> {
        ffi::hamlib_result("rot_open", unsafe { sys::rot_open(self.handle.as_ptr()) })?;
        self.open = true;
        self.owned = false;
        Ok(Rotator {
            handle: self.handle,
            model: self.model,
            open: true,
            owned: true,
            state: PhantomData,
            not_send_or_sync: PhantomData,
        })
    }
}

impl Rotator<RotatorOpen> {
    pub fn position(&mut self) -> Result<Position, HamlibError> {
        let (mut a, mut e) = (0.0, 0.0);
        ffi::hamlib_result("rot_get_position", unsafe {
            sys::rot_get_position(self.handle.as_ptr(), &mut a, &mut e)
        })?;
        Position::new(f64::from(a), f64::from(e))
    }
    pub fn set_position(&mut self, position: Position) -> Result<(), HamlibError> {
        ffi::hamlib_result("rot_set_position", unsafe {
            sys::rot_set_position(
                self.handle.as_ptr(),
                position.azimuth as f32,
                position.elevation as f32,
            )
        })
    }
    pub fn close(mut self) -> Result<Rotator<RotatorClosed>, HamlibError> {
        ffi::hamlib_result("rot_close", unsafe { sys::rot_close(self.handle.as_ptr()) })?;
        self.open = false;
        self.owned = false;
        Ok(Rotator {
            handle: self.handle,
            model: self.model,
            open: false,
            owned: true,
            state: PhantomData,
            not_send_or_sync: PhantomData,
        })
    }
}

impl<S> Drop for Rotator<S> {
    fn drop(&mut self) {
        if self.owned {
            if self.open {
                let _ = unsafe { sys::rot_close(self.handle.as_ptr()) };
            }
            let _ = unsafe { sys::rot_cleanup(self.handle.as_ptr()) };
        }
    }
}
