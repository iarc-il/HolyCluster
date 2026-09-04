use std::{
    collections::BTreeMap,
    fs, io,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::radio_config::{
    ActiveRadioBackend, HamlibRigConfig, RadioConfig, RadioConfigError, RadioRigConfig,
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
    RadioRigConfig::Hamlib {
        hamlib: HamlibRigConfig {
            model_id: model_id.into(),
            token_values: BTreeMap::from([("rig_pathname".into(), "/dev/ttyUSB0".into())]),
        },
    }
}

fn two_rig_config() -> RadioConfig {
    RadioConfig {
        rig1: hamlib("1"),
        rig2: Some(hamlib("2")),
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

    assert_eq!(config.rig1, RadioRigConfig::Unconfigured);
    assert!(config.rig2.is_none());
}

#[test]
fn round_trips_independently_configured_rigs() {
    let directory = TestDir::new();
    let config = RadioConfig {
        rig1: RadioConfig::platform_default().rig1,
        rig2: Some(hamlib("2")),
    };

    config.save_to_path(&directory.file()).unwrap();

    assert_eq!(
        RadioConfig::load_from_path(&directory.file()).unwrap(),
        config
    );
}

#[test]
fn rejects_unknown_schema_version() {
    let directory = TestDir::new();

    fs::write(
        directory.file(),
        r#"{"version":3,"rig1":{"backend":"unconfigured"}}"#,
    )
    .unwrap();
    assert!(matches!(
        RadioConfig::load_from_path(&directory.file()),
        Err(RadioConfigError::UnsupportedVersion(3))
    ));
}

#[test]
fn preserves_last_complete_file_when_atomic_write_cannot_create_temporary_file() {
    let directory = TestDir::new();
    let path = directory.file();
    let previous = two_rig_config();
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
    let previous = two_rig_config();
    previous.save_to_path(&path).unwrap();
    let previous_bytes = fs::read(&path).unwrap();

    let result = RadioConfig::platform_default()
        .save_to_path_with_rename(&path, |_, _| Err(io::Error::other("forced rename failure")));

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
        ActiveRadioBackend::Configured(config.rig1.backend())
    );
    assert!(!persisted.contains("dummy"));
}
