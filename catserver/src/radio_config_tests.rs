use std::{
    collections::BTreeMap,
    fs, io,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::radio_config::{
    ActiveRadioBackend, HamlibRigConfig, RadioBackendKind, RadioConfig, RadioConfigError,
    RadioRigConfig, RigctldConfig, DEFAULT_RIGCTLD_HOST, DEFAULT_RIGCTLD_PORT,
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
    RadioRigConfig::hamlib(HamlibRigConfig {
        model_id: model_id.into(),
        token_values: BTreeMap::from([("rig_pathname".into(), "/dev/ttyUSB0".into())]),
    })
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
fn round_trips_independently_configured_rigs() {
    let directory = TestDir::new();
    let config = RadioConfig {
        rig1: RadioConfig::platform_default().rig1,
        rig2: Some(hamlib("2")),
    };

    config.save_to_path(&directory.file()).unwrap();

    assert_eq!(RadioConfig::load_from_path(&directory.file()).unwrap(), config);
}

#[test]
fn migrates_legacy_global_backend_configuration() {
    let directory = TestDir::new();
    fs::write(
        directory.file(),
        r#"{"version":1,"backend":"hamlib","hamlib":{"rig1":{"model_id":"1","token_values":{}},"rig2":{"model_id":"2","token_values":{}}}}"#,
    )
    .unwrap();

    assert_eq!(RadioConfig::load_from_path(&directory.file()).unwrap(), RadioConfig {
        rig1: RadioRigConfig::hamlib(HamlibRigConfig {
            model_id: "1".into(),
            token_values: BTreeMap::new(),
        }),
        rig2: Some(RadioRigConfig::hamlib(HamlibRigConfig {
            model_id: "2".into(),
            token_values: BTreeMap::new(),
        })),
    });
}

#[test]
fn defaults_rigctld_endpoint_when_omitted() {
    let config: RadioRigConfig = serde_json::from_str(r#"{"backend":"rigctld","rigctld":{}}"#).unwrap();

    assert_eq!(config.rigctld, Some(RigctldConfig {
        host: DEFAULT_RIGCTLD_HOST.into(),
        port: DEFAULT_RIGCTLD_PORT,
    }));
}

#[cfg(not(windows))]
#[test]
fn rejects_invalid_rigctld_endpoints() {
    let config = RadioConfig {
        rig1: RadioRigConfig {
            backend: RadioBackendKind::Rigctld,
            hamlib: None,
            rigctld: Some(RigctldConfig {
                host: " ".into(),
                port: 0,
            }),
        },
        rig2: None,
    };

    assert!(matches!(config.validate(), Err(RadioConfigError::InvalidRigctldHost(_))));

    let config = RadioConfig {
        rig1: RadioRigConfig {
            backend: RadioBackendKind::Rigctld,
            hamlib: None,
            rigctld: Some(RigctldConfig {
                host: "127.0.0.1".into(),
                port: 0,
            }),
        },
        rig2: None,
    };

    assert!(matches!(config.validate(), Err(RadioConfigError::InvalidRigctldPort)));
}

#[test]
fn rejects_unknown_schema_version_and_backend() {
    let directory = TestDir::new();

    fs::write(directory.file(), r#"{"version":3,"rig1":{"backend":"rigctld"}}"#).unwrap();
    assert!(matches!(
        RadioConfig::load_from_path(&directory.file()),
        Err(RadioConfigError::UnsupportedVersion(3))
    ));

    fs::write(directory.file(), r#"{"version":1,"backend":"unknown"}"#).unwrap();
    assert!(matches!(
        RadioConfig::load_from_path(&directory.file()),
        Err(RadioConfigError::UnknownBackend(_))
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
        ActiveRadioBackend::Configured(config.rig1.backend)
    );
    assert!(!persisted.contains("dummy"));
}
