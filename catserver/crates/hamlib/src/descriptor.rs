#![allow(unsafe_code)]

use std::ffi::{CStr, CString, c_char};

use hamlib_sys as sys;

use crate::{CatalogError, ConfigDescriptor, ConfigToken, ConfigTokenError};

pub(crate) fn copy(
    param: *const sys::confparams,
    rig: *mut sys::RIG,
) -> Result<Option<ConfigDescriptor>, CatalogError> {
    if param.is_null() {
        return Err(CatalogError::NullMetadata {
            subject: "configuration descriptor",
            field: "parameter",
        });
    }
    // SAFETY: Hamlib provides a live `confparams` pointer for the callback duration.
    let param = unsafe { &*param };
    let name = string(param.name, "configuration descriptor", "name")?;
    if !is_configuration_parameter(rig, &name)? {
        return Ok(None);
    }
    let token =
        ConfigToken::try_from(name.clone()).map_err(|error| CatalogError::MalformedDescriptor {
            token: name.clone(),
            reason: match error {
                ConfigTokenError::Empty => "empty name",
                ConfigTokenError::EmbeddedNul => "embedded NUL name",
            },
        })?;
    let label = string(param.label, "configuration descriptor", "label")?;
    let tooltip = string(param.tooltip, "configuration descriptor", "tooltip")?;
    let default = string(param.dflt, "configuration descriptor", "default")?;
    from_parts(param, token, label, tooltip, default).map(Some)
}

fn is_configuration_parameter(rig: *mut sys::RIG, name: &str) -> Result<bool, CatalogError> {
    let name = CString::new(name).map_err(|_| CatalogError::MalformedDescriptor {
        token: name.to_owned(),
        reason: "embedded NUL name",
    })?;
    // SAFETY: `rig` is the live temporary handle and `name` remains NUL-terminated for the call.
    Ok(!(unsafe { sys::rig_confparam_lookup(rig, name.as_ptr()) }).is_null())
}

pub(crate) fn from_parts(
    param: &sys::confparams,
    token: ConfigToken,
    label: String,
    tooltip: String,
    default: String,
) -> Result<ConfigDescriptor, CatalogError> {
    match param.type_ {
        sys::rig_conf_e_RIG_CONF_STRING => Ok(text(token, label, tooltip, default)),
        sys::rig_conf_e_RIG_CONF_NUMERIC => numeric(param, token, label, tooltip, default),
        sys::rig_conf_e_RIG_CONF_INT => integer(param, token, label, tooltip, default),
        sys::rig_conf_e_RIG_CONF_CHECKBUTTON => boolean(token, label, tooltip, default),
        sys::rig_conf_e_RIG_CONF_COMBO => combo(param, token, label, tooltip, default),
        _ => Err(malformed(&token, "unsupported configuration type")),
    }
}

fn text(token: ConfigToken, label: String, tooltip: String, default: String) -> ConfigDescriptor {
    if token.as_str().ends_with("pathname") {
        ConfigDescriptor::Path {
            token,
            label,
            tooltip,
            default,
        }
    } else {
        ConfigDescriptor::Text {
            token,
            label,
            tooltip,
            default,
        }
    }
}

fn numeric(
    param: &sys::confparams,
    token: ConfigToken,
    label: String,
    tooltip: String,
    default: String,
) -> Result<ConfigDescriptor, CatalogError> {
    // SAFETY: the `RIG_CONF_NUMERIC` tag selects the numeric union member.
    let range = unsafe { param.u.n };
    let minimum = f64::from(range.min);
    let maximum = f64::from(range.max);
    let step = f64::from(range.step);
    let default = finite(&default, &token)?;
    validate_range(minimum, maximum, step, &token)?;
    Ok(ConfigDescriptor::Numeric {
        token,
        label,
        tooltip,
        default,
        minimum,
        maximum,
        step,
    })
}

fn integer(
    param: &sys::confparams,
    token: ConfigToken,
    label: String,
    tooltip: String,
    default: String,
) -> Result<ConfigDescriptor, CatalogError> {
    // SAFETY: the `RIG_CONF_INT` tag selects the numeric union member.
    let range = unsafe { param.u.n };
    let minimum = integer_value(f64::from(range.min), &token)?;
    let maximum = integer_value(f64::from(range.max), &token)?;
    let step = integer_value(f64::from(range.step), &token)?;
    let default = default
        .parse::<i64>()
        .map_err(|_| malformed(&token, "non-integer default"))?;
    if minimum > maximum || step <= 0 {
        return Err(malformed(&token, "invalid integer range"));
    }
    Ok(ConfigDescriptor::Integer {
        token,
        label,
        tooltip,
        default,
        minimum,
        maximum,
        step,
    })
}

fn boolean(
    token: ConfigToken,
    label: String,
    tooltip: String,
    default: String,
) -> Result<ConfigDescriptor, CatalogError> {
    let default = match default.as_str() {
        "0" => false,
        "1" => true,
        _ => return Err(malformed(&token, "non-boolean default")),
    };
    Ok(ConfigDescriptor::Boolean {
        token,
        label,
        tooltip,
        default,
    })
}

fn combo(
    param: &sys::confparams,
    token: ConfigToken,
    label: String,
    tooltip: String,
    default: String,
) -> Result<ConfigDescriptor, CatalogError> {
    // SAFETY: the `RIG_CONF_COMBO` tag selects the combo union member.
    let combo = unsafe { param.u.c };
    let mut terminated = false;
    let mut options = Vec::new();
    for pointer in combo.combostr {
        if pointer.is_null() {
            terminated = true;
        } else if terminated {
            return Err(malformed(&token, "combo data after terminator"));
        } else {
            options.push(string(pointer, "configuration descriptor", "combo option")?);
        }
    }
    if !terminated || options.is_empty() || !options.contains(&default) {
        return Err(malformed(&token, "malformed combo options or default"));
    }
    Ok(ConfigDescriptor::Combo {
        token,
        label,
        tooltip,
        default,
        options,
    })
}

fn finite(value: &str, token: &ConfigToken) -> Result<f64, CatalogError> {
    let value = value
        .parse::<f64>()
        .map_err(|_| malformed(token, "non-numeric default"))?;
    if value.is_finite() {
        Ok(value)
    } else {
        Err(malformed(token, "non-finite default"))
    }
}

fn validate_range(
    minimum: f64,
    maximum: f64,
    step: f64,
    token: &ConfigToken,
) -> Result<(), CatalogError> {
    if !minimum.is_finite()
        || !maximum.is_finite()
        || !step.is_finite()
        || minimum > maximum
        || step <= 0.0
    {
        return Err(malformed(token, "invalid numeric range"));
    }
    Ok(())
}

fn integer_value(value: f64, token: &ConfigToken) -> Result<i64, CatalogError> {
    if !value.is_finite() || value.fract() != 0.0 {
        return Err(malformed(token, "non-integer range"));
    }
    value
        .to_string()
        .parse::<i64>()
        .map_err(|_| malformed(token, "out-of-range integer"))
}

fn malformed(token: &ConfigToken, reason: &'static str) -> CatalogError {
    CatalogError::MalformedDescriptor {
        token: token.as_str().to_owned(),
        reason,
    }
}

pub(crate) fn string(
    pointer: *const c_char,
    subject: &'static str,
    field: &'static str,
) -> Result<String, CatalogError> {
    if pointer.is_null() {
        return Err(CatalogError::NullMetadata { subject, field });
    }
    // SAFETY: Hamlib's metadata contract provides NUL-terminated strings for non-null fields.
    unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .map(str::to_owned)
        .map_err(|_| CatalogError::InvalidUtf8 { subject, field })
}
