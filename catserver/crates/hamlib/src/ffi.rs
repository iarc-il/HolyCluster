#![allow(unsafe_code)]

use std::{
    collections::BTreeMap,
    ffi::{CStr, c_char, c_void},
    panic::{AssertUnwindSafe, catch_unwind},
    ptr,
    sync::OnceLock,
};

use hamlib_sys as sys;

use crate::{CatalogError, ConfigDescriptor, HamlibError, RigModel, RigModelId, RigModelStatus};

static BACKENDS: OnceLock<Result<(), HamlibError>> = OnceLock::new();

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

pub(crate) fn descriptors(model: RigModelId) -> Result<Vec<ConfigDescriptor>, CatalogError> {
    load_backends()?;
    let rig = TemporaryRig::new(model)?;
    let mut state: CallbackState<ConfigDescriptor> = CallbackState::for_rig(rig.pointer);
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
    rig: *mut sys::RIG,
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
            rig: ptr::null_mut(),
        }
    }
    fn for_rig(rig: *mut sys::RIG) -> Self {
        Self {
            values: Vec::new(),
            error: None,
            rig,
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

unsafe extern "C" fn descriptor_callback(param: *const sys::confparams, data: *mut c_void) -> i32 {
    // SAFETY: Hamlib invokes the callback with the state pointer passed to `rig_token_foreach`.
    let Some(state) = (unsafe { data.cast::<CallbackState<ConfigDescriptor>>().as_mut() }) else {
        return 0;
    };
    let rig = state.rig;
    invoke_callback(state, "configuration metadata", || {
        crate::descriptor::copy(param, rig)
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
    Ok(RigModel {
        id,
        manufacturer: string(metadata.mfg_name, "manufacturer")?,
        model: string(metadata.model_name, "name")?,
        version: string(metadata.version, "version")?,
        status,
    })
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
