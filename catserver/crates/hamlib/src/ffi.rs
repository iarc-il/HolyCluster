#![allow(unsafe_code)]

use std::{
    collections::BTreeMap,
    ffi::{CStr, c_char, c_void},
    panic::{AssertUnwindSafe, catch_unwind},
    sync::OnceLock,
};

use hamlib_sys as sys;

use crate::{
    CatalogError, ConfigDescriptor, HamlibError, RigModel, RigModelId, RigModelStatus, RigPortType,
    RotatorModel, RotatorModelId,
};

static BACKENDS: OnceLock<Result<(), HamlibError>> = OnceLock::new();
static ROTATOR_BACKENDS: OnceLock<Result<(), HamlibError>> = OnceLock::new();

pub(crate) fn models() -> Result<Vec<RigModel>, CatalogError> {
    load_backends()?;
    let mut state: CallbackState<RigModel> = CallbackState::new();
    // SAFETY: Hamlib calls the callback synchronously and receives the valid address of `state`.
    let result = unsafe {
        sys::rig_list_foreach(
            Some(model_callback),
            (&mut state as *mut CallbackState<RigModel>).cast(),
        )
    };
    hamlib_result("rig_list_foreach", result)?;
    state.finish("model metadata").map(|mut models| {
        models.sort_by(|left, right| {
            left.manufacturer
                .cmp(&right.manufacturer)
                .then_with(|| left.model.cmp(&right.model))
                .then_with(|| left.id.cmp(&right.id))
        });
        models
    })
}

pub(crate) fn rotator_models() -> Result<Vec<RotatorModel>, CatalogError> {
    load_rotator_backends()?;
    let mut state: CallbackState<RotatorModel> = CallbackState::new();
    // SAFETY: Hamlib calls the callback synchronously and receives the valid address of `state`.
    let result = unsafe {
        sys::rot_list_foreach(
            Some(rotator_model_callback),
            (&mut state as *mut CallbackState<RotatorModel>).cast(),
        )
    };
    hamlib_result("rot_list_foreach", result)?;
    state.finish("rotator model metadata").map(|mut models| {
        models.sort_by(|left, right| {
            left.manufacturer
                .cmp(&right.manufacturer)
                .then_with(|| left.model.cmp(&right.model))
                .then_with(|| left.id.cmp(&right.id))
        });
        models
    })
}

pub(crate) fn descriptors(model: RigModelId) -> Result<Vec<ConfigDescriptor>, CatalogError> {
    load_backends()?;
    let rig = TemporaryRig::new(model)?;
    let mut state: CallbackState<ConfigDescriptor> =
        CallbackState::for_target(crate::descriptor::ConfigurationTarget::Rig(rig.pointer));
    // SAFETY: `rig` is valid until its guard drops after synchronous callback completion.
    let result = unsafe {
        sys::rig_token_foreach(
            rig.pointer,
            Some(descriptor_callback),
            (&mut state as *mut CallbackState<ConfigDescriptor>).cast(),
        )
    };
    hamlib_result("rig_token_foreach", result)?;
    unique_descriptors(state.finish("configuration metadata")?)
}

pub(crate) fn rotator_descriptors(
    model: RotatorModelId,
) -> Result<Vec<ConfigDescriptor>, CatalogError> {
    load_rotator_backends()?;
    let rotator = TemporaryRotator::new(model)?;
    let mut state: CallbackState<ConfigDescriptor> = CallbackState::for_target(
        crate::descriptor::ConfigurationTarget::Rotator(rotator.pointer),
    );
    // SAFETY: `rotator` is valid until its guard drops after synchronous callback completion.
    let result = unsafe {
        sys::rot_token_foreach(
            rotator.pointer,
            Some(descriptor_callback),
            (&mut state as *mut CallbackState<ConfigDescriptor>).cast(),
        )
    };
    hamlib_result("rot_token_foreach", result)?;
    unique_descriptors(state.finish("rotator configuration metadata")?)
}

pub(crate) fn unique_descriptors(
    descriptors: Vec<ConfigDescriptor>,
) -> Result<Vec<ConfigDescriptor>, CatalogError> {
    let mut tokens = BTreeMap::new();
    for descriptor in descriptors {
        let token = descriptor.token().as_str().to_owned();
        if tokens.insert(token.clone(), descriptor).is_some() {
            return Err(CatalogError::DuplicateToken { token });
        }
    }
    Ok(tokens.into_values().collect())
}

pub(crate) fn load_backends() -> Result<(), HamlibError> {
    BACKENDS
        .get_or_init(|| {
            configure_debug();
            // SAFETY: Hamlib's process-wide backend registry is initialized exactly once here.
            hamlib_result("rig_load_all_backends", unsafe {
                sys::rig_load_all_backends()
            })
        })
        .clone()
}

pub(crate) fn load_rotator_backends() -> Result<(), HamlibError> {
    ROTATOR_BACKENDS
        .get_or_init(|| {
            configure_debug();
            // SAFETY: Hamlib's process-wide rotator backend registry is initialized exactly once.
            hamlib_result("rot_load_all_backends", unsafe {
                sys::rot_load_all_backends()
            })
        })
        .clone()
}

fn configure_debug() {
    // SAFETY: The callback has static lifetime and only reads Hamlib's message buffer.
    unsafe {
        sys::hamlib_sys_configure_debug(Some(hamlib_debug_callback));
    }
}

unsafe extern "C" fn hamlib_debug_callback(level: std::os::raw::c_int, message: *const c_char) {
    if message.is_null() {
        return;
    }
    let Ok(message) = (unsafe { CStr::from_ptr(message) }).to_str() else {
        return;
    };
    match level {
        0..=2 => tracing::error!(target: "hamlib", "{message}"),
        3 => tracing::warn!(target: "hamlib", "{message}"),
        _ => tracing::debug!(target: "hamlib", "{message}"),
    }
}

pub(crate) fn hamlib_result(operation: &'static str, result: i32) -> Result<(), HamlibError> {
    if result == 0 {
        return Ok(());
    }
    // SAFETY: Hamlib error functions accept return codes and return static NUL-terminated text.
    let short_message = error_text(unsafe { sys::rigerror2(result) }, operation, result)?
        .trim_end()
        .to_owned();
    let message = error_text(unsafe { sys::rigerror(result) }, operation, result)?;
    Err(HamlibError::Call {
        operation,
        code: result,
        short_message,
        message,
    })
}

fn error_text(
    pointer: *const std::os::raw::c_char,
    operation: &'static str,
    code: i32,
) -> Result<String, HamlibError> {
    if pointer.is_null() {
        return Err(HamlibError::NullErrorText { operation, code });
    }
    // SAFETY: Hamlib returns a NUL-terminated static string when non-null.
    unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .map(str::to_owned)
        .map_err(|_| HamlibError::InvalidErrorText { operation, code })
}

pub(crate) struct CallbackState<T> {
    values: Vec<T>,
    error: Option<CatalogError>,
    target: Option<crate::descriptor::ConfigurationTarget>,
}

fn record_error<T>(state: &mut CallbackState<T>, error: CatalogError) {
    if state.error.is_none() {
        state.error = Some(error);
    }
}

pub(crate) fn invoke_callback<T, F>(
    state: &mut CallbackState<T>,
    operation: &'static str,
    callback: F,
) -> i32
where
    F: FnOnce() -> Result<Option<T>, CatalogError>,
{
    match catch_unwind(AssertUnwindSafe(callback)) {
        Ok(Ok(Some(value))) => state.values.push(value),
        Ok(Ok(None)) => {}
        Ok(Err(error)) => record_error(state, error),
        Err(_) => record_error(state, CatalogError::CallbackPanic { operation }),
    }
    i32::from(state.error.is_none())
}

impl<T> CallbackState<T> {
    pub(crate) fn new() -> Self {
        Self {
            values: Vec::new(),
            error: None,
            target: None,
        }
    }
    fn for_target(target: crate::descriptor::ConfigurationTarget) -> Self {
        Self {
            values: Vec::new(),
            error: None,
            target: Some(target),
        }
    }
    pub(crate) fn finish(self, operation: &'static str) -> Result<Vec<T>, CatalogError> {
        self.error
            .map_or_else(|| Ok(self.values), Err)
            .map_err(|error| match error {
                CatalogError::CallbackPanic { .. } => CatalogError::CallbackPanic { operation },
                error => error,
            })
    }
}

unsafe extern "C" fn model_callback(caps: *const sys::rig_caps, data: *mut c_void) -> i32 {
    // SAFETY: Hamlib invokes the callback with the state pointer passed to `rig_list_foreach`.
    let Some(state) = (unsafe { data.cast::<CallbackState<RigModel>>().as_mut() }) else {
        return 0;
    };
    invoke_callback(state, "model metadata", || copy_model(caps).map(Some))
}

unsafe extern "C" fn rotator_model_callback(caps: *const sys::rot_caps, data: *mut c_void) -> i32 {
    // SAFETY: Hamlib invokes the callback with the state pointer passed to `rot_list_foreach`.
    let Some(state) = (unsafe { data.cast::<CallbackState<RotatorModel>>().as_mut() }) else {
        return 0;
    };
    invoke_callback(state, "rotator model metadata", || {
        copy_rotator_model(caps).map(Some)
    })
}

unsafe extern "C" fn descriptor_callback(param: *const sys::confparams, data: *mut c_void) -> i32 {
    // SAFETY: Hamlib invokes the callback with the state pointer passed to `rig_token_foreach`.
    let Some(state) = (unsafe { data.cast::<CallbackState<ConfigDescriptor>>().as_mut() }) else {
        return 0;
    };
    let Some(target) = state.target else {
        record_error(
            state,
            CatalogError::NullMetadata {
                subject: "configuration descriptor",
                field: "target",
            },
        );
        return 0;
    };
    invoke_callback(state, "configuration metadata", || {
        crate::descriptor::copy(param, target)
    })
}

fn copy_model(caps: *const sys::rig_caps) -> Result<RigModel, CatalogError> {
    if caps.is_null() {
        return Err(CatalogError::NullMetadata {
            subject: "model",
            field: "caps",
        });
    }
    // SAFETY: non-null `caps` is a live callback argument and the shim reads its prefix fields.
    let metadata = unsafe { sys::hamlib_sys_rig_caps_metadata(caps) };
    if metadata.is_null() {
        return Err(CatalogError::NullMetadata {
            subject: "model",
            field: "metadata",
        });
    }
    // SAFETY: the shim returns a pointer to the callback's live `rig_caps` prefix metadata.
    let metadata = unsafe { &*metadata };
    let id = RigModelId::new(metadata.rig_model);
    let status = match metadata.status {
        sys::rig_status_e_RIG_STATUS_ALPHA => RigModelStatus::Alpha,
        sys::rig_status_e_RIG_STATUS_UNTESTED => RigModelStatus::Untested,
        sys::rig_status_e_RIG_STATUS_BETA => RigModelStatus::Beta,
        sys::rig_status_e_RIG_STATUS_STABLE => RigModelStatus::Stable,
        sys::rig_status_e_RIG_STATUS_BUGGY => RigModelStatus::Buggy,
        status => return Err(CatalogError::InvalidStatus { model: id, status }),
    };
    let port_type = match metadata.port_type {
        sys::rig_port_e_RIG_PORT_NONE => RigPortType::None,
        sys::rig_port_e_RIG_PORT_SERIAL => RigPortType::Serial,
        sys::rig_port_e_RIG_PORT_NETWORK => RigPortType::Network,
        sys::rig_port_e_RIG_PORT_DEVICE => RigPortType::Device,
        sys::rig_port_e_RIG_PORT_PACKET => RigPortType::Packet,
        sys::rig_port_e_RIG_PORT_DTMF => RigPortType::Dtmf,
        sys::rig_port_e_RIG_PORT_ULTRA => RigPortType::Ultra,
        sys::rig_port_e_RIG_PORT_RPC => RigPortType::Rpc,
        sys::rig_port_e_RIG_PORT_PARALLEL => RigPortType::Parallel,
        sys::rig_port_e_RIG_PORT_USB => RigPortType::Usb,
        sys::rig_port_e_RIG_PORT_UDP_NETWORK => RigPortType::UdpNetwork,
        sys::rig_port_e_RIG_PORT_CM108 => RigPortType::Cm108,
        sys::rig_port_e_RIG_PORT_GPIO => RigPortType::Gpio,
        sys::rig_port_e_RIG_PORT_GPION => RigPortType::Gpion,
        _ => return Err(CatalogError::InvalidPortType { model: id }),
    };
    Ok(RigModel {
        id,
        manufacturer: string(metadata.mfg_name, "manufacturer")?,
        model: string(metadata.model_name, "name")?,
        version: string(metadata.version, "version")?,
        status,
        port_type,
    })
}

fn copy_rotator_model(caps: *const sys::rot_caps) -> Result<RotatorModel, CatalogError> {
    if caps.is_null() {
        return Err(CatalogError::NullMetadata {
            subject: "rotator model",
            field: "caps",
        });
    }
    // SAFETY: non-null `caps` is a live callback argument and the shim reads its prefix fields.
    let metadata = unsafe { sys::hamlib_sys_rot_caps_metadata(caps) };
    if metadata.is_null() {
        return Err(CatalogError::NullMetadata {
            subject: "rotator model",
            field: "metadata",
        });
    }
    // SAFETY: the shim returns a pointer to the callback's live `rot_caps` prefix metadata.
    let metadata = unsafe { &*metadata };
    let id = RotatorModelId::new(metadata.rot_model);
    let status = rotator_status(id, metadata.status)?;
    let port_type = rotator_port_type(id, metadata.port_type)?;
    // SAFETY: `caps` remains live for the callback and each shim only reads capability fields.
    let minimum_azimuth = f64::from(unsafe { sys::hamlib_sys_rot_caps_min_az(caps) });
    let maximum_azimuth = f64::from(unsafe { sys::hamlib_sys_rot_caps_max_az(caps) });
    if !minimum_azimuth.is_finite()
        || !maximum_azimuth.is_finite()
        || minimum_azimuth > maximum_azimuth
    {
        return Err(CatalogError::InvalidRotatorRange { model: id });
    }
    Ok(RotatorModel {
        id,
        manufacturer: string(metadata.mfg_name, "manufacturer")?,
        model: string(metadata.model_name, "name")?,
        version: string(metadata.version, "version")?,
        status,
        port_type,
        minimum_azimuth,
        maximum_azimuth,
        // SAFETY: `caps` remains live for the callback and the shims only inspect function pointers.
        can_get_position: unsafe { sys::hamlib_sys_rot_caps_can_get_position(caps) } != 0,
        can_set_position: unsafe { sys::hamlib_sys_rot_caps_can_set_position(caps) } != 0,
    })
}

fn rotator_status(
    model: RotatorModelId,
    status: sys::rig_status_e,
) -> Result<RigModelStatus, CatalogError> {
    match status {
        sys::rig_status_e_RIG_STATUS_ALPHA => Ok(RigModelStatus::Alpha),
        sys::rig_status_e_RIG_STATUS_UNTESTED => Ok(RigModelStatus::Untested),
        sys::rig_status_e_RIG_STATUS_BETA => Ok(RigModelStatus::Beta),
        sys::rig_status_e_RIG_STATUS_STABLE => Ok(RigModelStatus::Stable),
        sys::rig_status_e_RIG_STATUS_BUGGY => Ok(RigModelStatus::Buggy),
        status => Err(CatalogError::InvalidRotatorStatus { model, status }),
    }
}

fn rotator_port_type(
    model: RotatorModelId,
    port_type: sys::rig_port_e,
) -> Result<RigPortType, CatalogError> {
    match port_type {
        sys::rig_port_e_RIG_PORT_NONE => Ok(RigPortType::None),
        sys::rig_port_e_RIG_PORT_SERIAL => Ok(RigPortType::Serial),
        sys::rig_port_e_RIG_PORT_NETWORK => Ok(RigPortType::Network),
        sys::rig_port_e_RIG_PORT_DEVICE => Ok(RigPortType::Device),
        sys::rig_port_e_RIG_PORT_PACKET => Ok(RigPortType::Packet),
        sys::rig_port_e_RIG_PORT_DTMF => Ok(RigPortType::Dtmf),
        sys::rig_port_e_RIG_PORT_ULTRA => Ok(RigPortType::Ultra),
        sys::rig_port_e_RIG_PORT_RPC => Ok(RigPortType::Rpc),
        sys::rig_port_e_RIG_PORT_PARALLEL => Ok(RigPortType::Parallel),
        sys::rig_port_e_RIG_PORT_USB => Ok(RigPortType::Usb),
        sys::rig_port_e_RIG_PORT_UDP_NETWORK => Ok(RigPortType::UdpNetwork),
        sys::rig_port_e_RIG_PORT_CM108 => Ok(RigPortType::Cm108),
        sys::rig_port_e_RIG_PORT_GPIO => Ok(RigPortType::Gpio),
        sys::rig_port_e_RIG_PORT_GPION => Ok(RigPortType::Gpion),
        _ => Err(CatalogError::InvalidRotatorPortType { model }),
    }
}

fn string(pointer: *const c_char, field: &'static str) -> Result<String, CatalogError> {
    if pointer.is_null() {
        return Err(CatalogError::NullMetadata {
            subject: "model",
            field,
        });
    }
    // SAFETY: Hamlib's model metadata contract provides NUL-terminated strings for non-null fields.
    unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .map(str::to_owned)
        .map_err(|_| CatalogError::InvalidUtf8 {
            subject: "model",
            field,
        })
}

pub(crate) struct TemporaryRig {
    pointer: *mut sys::RIG,
    cleanup: Cleanup,
}

enum Cleanup {
    Hamlib,
    #[cfg(test)]
    Fixture(fn(*mut sys::RIG) -> i32),
}

impl TemporaryRig {
    fn new(model: RigModelId) -> Result<Self, CatalogError> {
        // SAFETY: backends are initialized before this private temporary handle is constructed.
        let pointer = unsafe { sys::rig_init(model.get()) };
        if pointer.is_null() {
            return Err(HamlibError::NullHandle {
                operation: "rig_init",
                model,
            }
            .into());
        }
        Ok(Self {
            pointer,
            cleanup: Cleanup::Hamlib,
        })
    }

    #[cfg(test)]
    pub(crate) fn with_cleanup(pointer: *mut sys::RIG, cleanup: fn(*mut sys::RIG) -> i32) -> Self {
        Self {
            pointer,
            cleanup: Cleanup::Fixture(cleanup),
        }
    }
}

struct TemporaryRotator {
    pointer: *mut sys::ROT,
}

impl TemporaryRotator {
    fn new(model: RotatorModelId) -> Result<Self, CatalogError> {
        // SAFETY: backends are initialized before this private temporary handle is constructed.
        let pointer = unsafe { sys::rot_init(model.get()) };
        if pointer.is_null() {
            return Err(HamlibError::NullRotatorHandle {
                operation: "rot_init",
                model,
            }
            .into());
        }
        Ok(Self { pointer })
    }
}

impl Drop for TemporaryRotator {
    fn drop(&mut self) {
        // SAFETY: the handle is exclusively owned and live until this guard drops.
        let _ = unsafe { sys::rot_cleanup(self.pointer) };
    }
}

impl Drop for TemporaryRig {
    fn drop(&mut self) {
        // SAFETY: `TemporaryRig` exclusively owns the non-null handle returned by `rig_init`.
        match self.cleanup {
            Cleanup::Hamlib => {
                // SAFETY: the handle is exclusively owned and live until this guard drops.
                let _ = unsafe { sys::rig_cleanup(self.pointer) };
            }
            #[cfg(test)]
            Cleanup::Fixture(cleanup) => {
                let _ = cleanup(self.pointer);
            }
        }
    }
}
