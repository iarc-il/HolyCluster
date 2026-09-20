use std::{
    collections::BTreeMap,
    fs, io,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::radio_config::{
    ActiveRadioBackend, OmniRigSlot, RadioBackendKind, RadioConfig, RadioConfigError,
    RadioRigConfig, ResolvedRadioModel, resolve_model_id,
};

struct TestDir(PathBuf);

impl TestDir {
    fn new() -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("catserver-radio-config-{unique}"));
        fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn file(&self) -> PathBuf {
        self.0.join("radio.json")
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn hamlib(model_id: &str) -> RadioRigConfig {
    RadioRigConfig {
        model_id: model_id.into(),
        token_values: BTreeMap::from([("rig_pathname".into(), "/dev/ttyUSB0".into())]),
    }
}

fn configured() -> RadioConfig {
    RadioConfig {
        rig: Some(hamlib("hamlib:1")),
    }
}

#[test]
fn returns_platform_default_when_config_file_is_missing() {
    let directory = TestDir::new();

    let loaded = RadioConfig::load_from_path(&directory.file()).unwrap();

    assert_eq!(loaded, RadioConfig::platform_default());
}

#[test]
fn defaults_to_an_unconfigured_rig_without_connecting_to_hardware() {
    let config = RadioConfig::platform_default();

    assert_eq!(config.rig, None);
}

#[test]
fn round_trips_single_optional_rig() {
    let directory = TestDir::new();
    let config = configured();

    config.save_to_path(&directory.file()).unwrap();

    let persisted = fs::read_to_string(directory.file()).unwrap();
    assert!(persisted.contains(r#""version": 3"#));
    assert!(persisted.contains(r#""rig""#));
    assert!(!persisted.contains("rig1"));
    assert!(!persisted.contains("rig2"));
    assert!(!persisted.contains("backend"));
    assert_eq!(
        RadioConfig::load_from_path(&directory.file()).unwrap(),
        config
    );
}

#[test]
fn round_trips_unconfigured_rig_as_null() {
    let directory = TestDir::new();
    let config = RadioConfig::platform_default();

    config.save_to_path(&directory.file()).unwrap();

    let persisted = fs::read_to_string(directory.file()).unwrap();
    assert!(persisted.contains(r#""rig": null"#));
    assert_eq!(
        RadioConfig::load_from_path(&directory.file()).unwrap(),
        config
    );
}

#[test]
fn treats_development_schema_versions_as_unconfigured() {
    for version in [1, 2] {
        let directory = TestDir::new();
        fs::write(
            directory.file(),
            format!(r#"{{"version":{version},"rig1":{{"backend":"hamlib"}}}}"#),
        )
        .unwrap();

        assert_eq!(
            RadioConfig::load_from_path(&directory.file()).unwrap(),
            RadioConfig::platform_default()
        );
    }
}

#[test]
fn rejects_unknown_schema_version() {
    let directory = TestDir::new();

    fs::write(directory.file(), r#"{"version":4,"rig":null}"#).unwrap();
    assert!(matches!(
        RadioConfig::load_from_path(&directory.file()),
        Err(RadioConfigError::UnsupportedVersion(4))
    ));
}

#[test]
fn resolves_supported_model_ids() {
    assert_eq!(
        resolve_model_id("hamlib:1").unwrap(),
        ResolvedRadioModel::Hamlib(hamlib::RigModelId::new(1))
    );
    assert_eq!(
        resolve_model_id("omnirig:1").unwrap(),
        ResolvedRadioModel::Omnirig(OmniRigSlot::Rig1)
    );
    assert_eq!(
        resolve_model_id("omnirig:2").unwrap(),
        ResolvedRadioModel::Omnirig(OmniRigSlot::Rig2)
    );
}

#[test]
fn rejects_malformed_or_unknown_model_ids() {
    for model_id in [
        "1",
        "hamlib:0",
        "hamlib:",
        "hamlib:not-a-number",
        "omnirig:3",
        "other:1",
    ] {
        assert!(matches!(
            resolve_model_id(model_id),
            Err(RadioConfigError::InvalidModelId(_))
        ));
    }
}

#[cfg(not(windows))]
#[test]
fn rejects_non_windows_omnirig_configs() {
    let config = RadioConfig {
        rig: Some(RadioRigConfig {
            model_id: "omnirig:1".into(),
            token_values: BTreeMap::new(),
        }),
    };

    assert!(matches!(
        config.validate_for_platform(crate::radio_config_store::RadioConfigPlatform::current()),
        Err(RadioConfigError::PlatformUnsupportedModel(model)) if model == "omnirig:1"
    ));
}

#[test]
fn preserves_last_complete_file_when_atomic_write_cannot_create_temporary_file() {
    let directory = TestDir::new();
    let path = directory.file();
    let previous = configured();
    previous.save_to_path(&path).unwrap();
    fs::create_dir(path.with_extension("json.tmp")).unwrap();

    let result = RadioConfig::platform_default().save_to_path(&path);

    assert!(matches!(result, Err(RadioConfigError::WriteTemporary(_))));
    assert_eq!(RadioConfig::load_from_path(&path).unwrap(), previous);
}

#[test]
fn removes_temporary_file_and_preserves_bytes_when_rename_fails() {
    let directory = TestDir::new();
    let path = directory.file();
    let previous = configured();
    previous.save_to_path(&path).unwrap();
    let previous_bytes = fs::read(&path).unwrap();

    let result = RadioConfig::platform_default().save_to_path_with_rename_for_platform(
        &path,
        crate::radio_config_store::RadioConfigPlatform::current(),
        |_, _| Err(io::Error::other("forced rename failure")),
    );

    assert!(matches!(result, Err(RadioConfigError::Rename(_))));
    assert_eq!(fs::read(&path).unwrap(), previous_bytes);
    assert!(!path.with_extension("json.tmp").exists());
}

#[test]
fn dummy_override_is_explicit_and_never_persisted() {
    let directory = TestDir::new();
    let config = RadioConfig::platform_default();

    config.save_to_path(&directory.file()).unwrap();
    let persisted = fs::read_to_string(directory.file()).unwrap();

    assert_eq!(config.effective_backend(true), ActiveRadioBackend::Dummy);
    assert_eq!(
        config.effective_backend(false),
        ActiveRadioBackend::Configured(RadioBackendKind::Unconfigured)
    );
    assert!(!persisted.contains("dummy"));
}
