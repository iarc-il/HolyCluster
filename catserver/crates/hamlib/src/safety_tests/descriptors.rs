use std::ffi::CString;

use hamlib_sys as sys;

use crate::{CatalogError, ConfigDescriptor, ConfigToken, descriptor};

fn token() -> ConfigToken {
    "fixture".parse().expect("valid fixture token")
}

fn numeric(minimum: f32, maximum: f32, step: f32) -> sys::confparams {
    sys::confparams {
        token: 1,
        name: c"fixture".as_ptr(),
        label: c"Label".as_ptr(),
        tooltip: c"Tooltip".as_ptr(),
        dflt: c"0".as_ptr(),
        type_: sys::rig_conf_e_RIG_CONF_NUMERIC,
        u: sys::confparams__bindgen_ty_1 {
            n: sys::confparams__bindgen_ty_1__bindgen_ty_1 {
                min: minimum,
                max: maximum,
                step,
            },
        },
    }
}

fn integer(minimum: f32, maximum: f32, step: f32) -> sys::confparams {
    sys::confparams {
        type_: sys::rig_conf_e_RIG_CONF_INT,
        ..numeric(minimum, maximum, step)
    }
}

fn boolean() -> sys::confparams {
    sys::confparams {
        token: 1,
        name: c"fixture".as_ptr(),
        label: c"Label".as_ptr(),
        tooltip: c"Tooltip".as_ptr(),
        dflt: c"invalid".as_ptr(),
        type_: sys::rig_conf_e_RIG_CONF_CHECKBUTTON,
        u: sys::confparams__bindgen_ty_1 {
            n: sys::confparams__bindgen_ty_1__bindgen_ty_1 {
                min: 0.0,
                max: 0.0,
                step: 0.0,
            },
        },
    }
}

struct ComboFixture {
    parameter: sys::confparams,
    _name: CString,
    _label: CString,
    _tooltip: CString,
    _default: CString,
    _options: Vec<CString>,
}

impl ComboFixture {
    fn new(default: &str, options: &[&str], terminated: bool) -> Self {
        let name = CString::new("combo").expect("static fixture name");
        let label = CString::new("Label").expect("static label");
        let tooltip = CString::new("Tooltip").expect("static tooltip");
        let default = CString::new(default).expect("fixture default");
        let options = options
            .iter()
            .map(|option| CString::new(*option).expect("fixture option"))
            .collect::<Vec<_>>();
        let mut pointers = [std::ptr::null(); 16];
        for (pointer, option) in pointers.iter_mut().zip(&options) {
            *pointer = option.as_ptr();
        }
        if !terminated && options.len() < pointers.len() {
            pointers[options.len()..].fill(name.as_ptr());
        }
        let parameter = sys::confparams {
            token: 1,
            name: name.as_ptr(),
            label: label.as_ptr(),
            tooltip: tooltip.as_ptr(),
            dflt: default.as_ptr(),
            type_: sys::rig_conf_e_RIG_CONF_COMBO,
            u: sys::confparams__bindgen_ty_1 {
                c: sys::confparams__bindgen_ty_1__bindgen_ty_2 { combostr: pointers },
            },
        };
        Self {
            parameter,
            _name: name,
            _label: label,
            _tooltip: tooltip,
            _default: default,
            _options: options,
        }
    }
}

#[test]
fn rejects_null_and_invalid_utf8_metadata() {
    assert!(matches!(
        descriptor::string(std::ptr::null(), "fixture", "label"),
        Err(CatalogError::NullMetadata { .. })
    ));
    let invalid = [0xff_u8, 0];
    assert!(matches!(
        descriptor::string(invalid.as_ptr().cast(), "fixture", "label"),
        Err(CatalogError::InvalidUtf8 { .. })
    ));
}

#[test]
fn rejects_non_finite_inverted_and_negative_step_ranges() {
    for parameter in [
        numeric(f32::NAN, 1.0, 1.0),
        numeric(0.0, f32::INFINITY, 1.0),
        numeric(0.0, 1.0, f32::NEG_INFINITY),
        numeric(2.0, 1.0, 1.0),
        numeric(0.0, 1.0, -1.0),
    ] {
        assert!(matches!(
            descriptor::from_parts(&parameter, token(), "L".into(), "T".into(), "0".into()),
            Err(CatalogError::MalformedDescriptor { .. })
        ));
    }
}

#[test]
fn accepts_numeric_range_without_a_step() {
    assert!(matches!(
        descriptor::from_parts(
            &numeric(0.0, 1.0, 0.0),
            token(),
            "L".into(),
            "T".into(),
            "0".into(),
        ),
        Ok(ConfigDescriptor::Numeric { step, .. }) if step == 0.0
    ));
}

#[test]
fn rejects_malformed_integer_and_boolean_values() {
    for (parameter, default) in [
        (integer(0.5, 1.0, 1.0), "0"),
        (integer(0.0, 1.0, 0.5), "0"),
        (integer(0.0, 1.0, 1.0), "invalid"),
        (boolean(), "invalid"),
    ] {
        assert!(matches!(
            descriptor::from_parts(&parameter, token(), "L".into(), "T".into(), default.into()),
            Err(CatalogError::MalformedDescriptor { .. })
        ));
    }
}

#[test]
fn accepts_terminated_combo_with_default_and_options() {
    let fixture = ComboFixture::new("one", &["zero", "one"], true);
    let descriptor = descriptor::from_parts(
        &fixture.parameter,
        token(),
        "L".into(),
        "T".into(),
        "one".into(),
    )
    .expect("valid combo fixture");
    assert!(matches!(
        descriptor,
        ConfigDescriptor::Combo { options, default, .. }
            if options == vec!["zero", "one"] && default == "one"
    ));
}

#[test]
fn rejects_combo_without_termination_or_matching_default() {
    let unterminated = ComboFixture::new("one", &["zero", "one"], false);
    let missing_default = ComboFixture::new("missing", &["zero", "one"], true);
    for fixture in [&unterminated, &missing_default] {
        assert!(matches!(
            descriptor::from_parts(
                &fixture.parameter,
                token(),
                "L".into(),
                "T".into(),
                fixture._default.to_str().expect("fixture UTF-8").into(),
            ),
            Err(CatalogError::MalformedDescriptor { .. })
        ));
    }
}

#[test]
fn rejects_unknown_descriptor_tag() {
    let parameter = sys::confparams {
        type_: 999,
        ..numeric(0.0, 1.0, 1.0)
    };
    assert!(matches!(
        descriptor::from_parts(&parameter, token(), "L".into(), "T".into(), "0".into()),
        Err(CatalogError::MalformedDescriptor { .. })
    ));
}
