use crate::{ConfigDescriptor, ConfigToken, ConfigValue, ConfigValueError};

fn token() -> ConfigToken {
    "fixture".parse().expect("valid fixture token")
}

#[test]
fn validates_descriptor_values_without_coercion() {
    let integer = ConfigDescriptor::Integer {
        token: token(),
        label: "L".into(),
        tooltip: "T".into(),
        default: 10,
        minimum: 0,
        maximum: 20,
        step: 5,
    };
    assert_eq!(integer.parse_value("15"), Ok(ConfigValue::Integer(15)));
    assert!(matches!(
        integer.parse_value("16"),
        Err(ConfigValueError::InvalidStep { .. })
    ));
    let invalid_step = ConfigDescriptor::Integer {
        token: token(),
        label: "L".into(),
        tooltip: "T".into(),
        default: 10,
        minimum: 0,
        maximum: 20,
        step: 0,
    };
    assert!(matches!(
        invalid_step.parse_value("15"),
        Err(ConfigValueError::InvalidStep { .. })
    ));
    assert!(matches!(
        integer.validate(&ConfigValue::Numeric(15.0)),
        Err(ConfigValueError::Invalid { .. })
    ));
}

#[test]
fn rejects_invalid_numeric_combo_and_text_values() {
    let numeric = ConfigDescriptor::Numeric {
        token: token(),
        label: "L".into(),
        tooltip: "T".into(),
        default: 0.0,
        minimum: 0.0,
        maximum: 1.0,
        step: 0.25,
    };
    let combo = ConfigDescriptor::Combo {
        token: token(),
        label: "L".into(),
        tooltip: "T".into(),
        default: "one".into(),
        options: vec!["one".into()],
    };
    let text = ConfigDescriptor::Text {
        token: token(),
        label: "L".into(),
        tooltip: "T".into(),
        default: "".into(),
    };
    assert!(matches!(
        numeric.parse_value("NaN"),
        Err(ConfigValueError::OutOfRange { .. })
    ));
    assert!(matches!(
        combo.parse_value("two"),
        Err(ConfigValueError::InvalidOption { .. })
    ));
    assert!(matches!(
        text.parse_value("a\0b"),
        Err(ConfigValueError::EmbeddedNul { .. })
    ));
}
