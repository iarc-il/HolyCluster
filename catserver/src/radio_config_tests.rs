use std::{
    collections::BTreeMap,
    fs, io,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::radio_config::{
    ActiveRadioBackend, HamlibConfig, HamlibRigConfig, RadioBackendKind, RadioConfig,
    RadioConfigError,
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

fn two_rig_config() -> RadioConfig {
    RadioConfig {
        backend: RadioBackendKind::Hamlib,
        hamlib: Some(HamlibConfig {
            rig1: HamlibRigConfig {
                model_id: "1".into(),
                token_values: BTreeMap::from([("rig_pathname".into(), "/dev/ttyUSB0".into())]),
            },
            rig2: Some(HamlibRigConfig {
                model_id: "2".into(),
                token_values: BTreeMap::from([("rig_pathname".into(), "/dev/ttyUSB1".into())]),
            }),
        }),
    }
}

#[test]
fn returns_platform_default_when_config_file_is_missing() {
    let directory = TestDir::new();

    let loaded = RadioConfig::load_from_path(&directory.file()).unwrap();

    assert_eq!(loaded, RadioConfig::platform_default());
}

#[test]
fn round_trips_one_and_two_hamlib_rigs() {
    let directory = TestDir::new();
    let one_rig = RadioConfig {
        backend: RadioBackendKind::Hamlib,
        hamlib: Some(HamlibConfig {
            rig1: HamlibRigConfig {
                model_id: "1".into(),
                token_values: BTreeMap::new(),
            },
            rig2: None,
        }),
    };

    one_rig.save_to_path(&directory.file()).unwrap();
    assert_eq!(
        RadioConfig::load_from_path(&directory.file()).unwrap(),
        one_rig
    );

    let two_rigs = two_rig_config();
    two_rigs.save_to_path(&directory.file()).unwrap();
    assert_eq!(
        RadioConfig::load_from_path(&directory.file()).unwrap(),
        two_rigs
    );
}

#[test]
fn rejects_unknown_schema_version_and_backend() {
    let directory = TestDir::new();

    fs::write(directory.file(), r#"{"version":2,"backend":"rigctld"}"#).unwrap();
    assert!(matches!(
        RadioConfig::load_from_path(&directory.file()),
        Err(RadioConfigError::UnsupportedVersion(2))
    ));

    fs::write(directory.file(), r#"{"version":1,"backend":"unknown"}"#).unwrap();
    assert!(matches!(
        RadioConfig::load_from_path(&directory.file()),
        Err(RadioConfigError::UnknownBackend(_))
    ));
}

#[test]
fn rejects_malformed_json_and_invalid_hamlib_shapes() {
    let directory = TestDir::new();

    fs::write(directory.file(), "{").unwrap();
    assert!(matches!(
        RadioConfig::load_from_path(&directory.file()),
        Err(RadioConfigError::Json(_))
    ));

    fs::write(
        directory.file(),
        r#"{"version":1,"backend":"hamlib","hamlib":{"rig1":{"model_id":"zero","token_values":{"":"9600"}}}}"#,
    )
    .unwrap();
    assert!(matches!(
        RadioConfig::load_from_path(&directory.file()),
        Err(RadioConfigError::InvalidModelId(_))
    ));

    fs::write(
        directory.file(),
        r#"{"version":1,"backend":"hamlib","hamlib":{"rig1":{"model_id":"1","token_values":{"":"9600"}}}}"#,
    )
    .unwrap();
    assert!(matches!(
        RadioConfig::load_from_path(&directory.file()),
        Err(RadioConfigError::InvalidToken(_))
    ));
}

#[test]
fn rejects_backend_not_supported_by_this_platform() {
    let directory = TestDir::new();
    let backend = if cfg!(windows) { "rigctld" } else { "omnirig" };

    fs::write(
        directory.file(),
        format!(r#"{{"version":1,"backend":"{backend}"}}"#),
    )
    .unwrap();

    assert!(matches!(
        RadioConfig::load_from_path(&directory.file()),
        Err(RadioConfigError::PlatformUnsupportedBackend(_))
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
        ActiveRadioBackend::Configured(config.backend)
    );
    assert!(!persisted.contains("dummy"));
}

#[test]
fn prints_canonical_one_and_two_rig_configurations_for_manual_qa() {
    let directory = TestDir::new();
    let one_rig = RadioConfig {
        backend: RadioBackendKind::Hamlib,
        hamlib: Some(HamlibConfig {
            rig1: HamlibRigConfig {
                model_id: "1".into(),
                token_values: BTreeMap::new(),
            },
            rig2: None,
        }),
    };

    one_rig.save_to_path(&directory.file()).unwrap();
    println!("one-rig={}", fs::read_to_string(directory.file()).unwrap());
    assert_eq!(
        RadioConfig::load_from_path(&directory.file()).unwrap(),
        one_rig
    );

    let two_rigs = two_rig_config();
    two_rigs.save_to_path(&directory.file()).unwrap();
    println!("two-rig={}", fs::read_to_string(directory.file()).unwrap());
    assert_eq!(
        RadioConfig::load_from_path(&directory.file()).unwrap(),
        two_rigs
    );

    let malformed_path = directory.0.join("malformed-radio.json");
    fs::write(&malformed_path, "{").unwrap();
    println!(
        "malformed-error={}",
        RadioConfig::load_from_path(&malformed_path).unwrap_err()
    );
    assert_eq!(
        RadioConfig::load_from_path(&directory.file()).unwrap(),
        two_rigs
    );
}
