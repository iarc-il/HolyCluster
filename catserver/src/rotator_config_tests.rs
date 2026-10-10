use std::{collections::BTreeMap, fs, path::PathBuf, time::SystemTime};

use crate::{hamlib_device_config::HamlibDeviceConfig, rotator_config::RotatorConfig};

struct TestDir(PathBuf);

impl TestDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "catserver-rotator-config-{}",
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn file(&self) -> PathBuf {
        self.0.join("rotator.json")
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn dummy_config() -> RotatorConfig {
    RotatorConfig::Hamlib {
        hamlib: HamlibDeviceConfig {
            model_id: hamlib::RotatorModelId::DUMMY.to_string(),
            token_values: BTreeMap::new(),
        },
    }
}

#[test]
fn missing_file_loads_unconfigured() {
    let directory = TestDir::new();
    assert_eq!(
        RotatorConfig::load_from_path(&directory.file()).unwrap(),
        RotatorConfig::Unconfigured
    );
}

#[test]
fn saves_and_loads_versioned_configuration() {
    let directory = TestDir::new();
    let config = dummy_config();
    config.save_to_path(&directory.file()).unwrap();

    assert_eq!(
        RotatorConfig::load_from_path(&directory.file()).unwrap(),
        config
    );
    let persisted = fs::read_to_string(directory.file()).unwrap();
    assert!(persisted.contains("\"version\": 1"));
}

#[test]
fn rejects_unknown_tokens_without_overwriting_file() {
    let directory = TestDir::new();
    fs::write(directory.file(), "original").unwrap();
    let config = RotatorConfig::Hamlib {
        hamlib: HamlibDeviceConfig {
            model_id: hamlib::RotatorModelId::DUMMY.to_string(),
            token_values: BTreeMap::from([("unknown_token".into(), "value".into())]),
        },
    };

    assert!(config.save_to_path(&directory.file()).is_err());
    assert_eq!(fs::read_to_string(directory.file()).unwrap(), "original");
}

#[test]
fn rejects_models_without_position_capabilities() {
    let config = RotatorConfig::Hamlib {
        hamlib: HamlibDeviceConfig {
            model_id: "701".into(),
            token_values: BTreeMap::new(),
        },
    };

    assert!(config.validate().is_err());
}

#[test]
fn removes_temporary_file_when_rename_fails() {
    let directory = TestDir::new();
    let file = directory.file();
    let result = dummy_config()
        .save_to_path_with_rename(&file, |_, _| Err(std::io::Error::other("rename failed")));

    assert!(result.is_err());
    assert!(!file.with_extension("json.tmp").exists());
}
