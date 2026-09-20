use std::{
    fmt,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

use crate::hamlib_device_config::{HamlibDeviceConfig, HamlibDeviceConfigError};

const CONFIG_FILE: &str = "rotator.json";
const SCHEMA_VERSION: u8 = 1;
type IoFailure = (PathBuf, std::io::Error);
type RenameFailure = (PathBuf, PathBuf, std::io::Error);

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(tag = "backend", rename_all = "snake_case")]
pub enum RotatorConfig {
    Unconfigured,
    Hamlib { hamlib: HamlibDeviceConfig },
}

#[derive(Debug)]
pub enum RotatorConfigError {
    ProjectDirectories,
    CreateConfigDirectory(IoFailure),
    Read(IoFailure),
    Json(serde_json::Error),
    Serialize(serde_json::Error),
    UnsupportedVersion(u8),
    InvalidDevice(HamlibDeviceConfigError),
    UnknownModel(hamlib::RotatorModelId),
    UnknownToken(String),
    InvalidValue(String, String),
    WriteTemporary(IoFailure),
    Rename(RenameFailure),
}

impl fmt::Display for RotatorConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for RotatorConfigError {}

#[derive(Deserialize)]
struct ConfigHeader {
    version: u8,
}

#[derive(Serialize)]
struct PersistedConfig<'a> {
    version: u8,
    #[serde(flatten)]
    config: &'a RotatorConfig,
}

impl RotatorConfig {
    pub const fn unconfigured() -> Self {
        Self::Unconfigured
    }

    pub fn config_path() -> Result<PathBuf, RotatorConfigError> {
        let project_dirs = ProjectDirs::from("org", "iarc", "holycluster")
            .ok_or(RotatorConfigError::ProjectDirectories)?;
        Ok(project_dirs.config_dir().join(CONFIG_FILE))
    }

    pub fn load_from_path(path: &Path) -> Result<Self, RotatorConfigError> {
        let contents = match fs::read_to_string(path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::unconfigured());
            }
            Err(source) => return Err(RotatorConfigError::Read((path.to_path_buf(), source))),
        };
        let header: ConfigHeader =
            serde_json::from_str(&contents).map_err(RotatorConfigError::Json)?;
        if header.version != SCHEMA_VERSION {
            return Err(RotatorConfigError::UnsupportedVersion(header.version));
        }
        let config: Self = serde_json::from_str(&contents).map_err(RotatorConfigError::Json)?;
        config.validate()?;
        Ok(config)
    }

    pub fn save(&self) -> Result<(), RotatorConfigError> {
        self.save_to_path(&Self::config_path()?)
    }

    pub fn save_to_path(&self, path: &Path) -> Result<(), RotatorConfigError> {
        self.save_to_path_with_rename(path, |from, to| fs::rename(from, to))
    }

    pub(crate) fn save_to_path_with_rename(
        &self,
        path: &Path,
        rename: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
    ) -> Result<(), RotatorConfigError> {
        self.validate()?;
        let parent = path
            .parent()
            .ok_or(RotatorConfigError::ProjectDirectories)?;
        fs::create_dir_all(parent).map_err(|source| {
            RotatorConfigError::CreateConfigDirectory((parent.to_path_buf(), source))
        })?;
        let temporary_path = path.with_extension("json.tmp");
        let serialized = serde_json::to_vec_pretty(&PersistedConfig {
            version: SCHEMA_VERSION,
            config: self,
        })
        .map_err(RotatorConfigError::Serialize)?;
        let write_result = File::create(&temporary_path)
            .and_then(|mut temporary| {
                temporary.write_all(&serialized)?;
                temporary.sync_all()
            })
            .map_err(|source| RotatorConfigError::WriteTemporary((temporary_path.clone(), source)));
        if let Err(error) = write_result {
            let _ = fs::remove_file(&temporary_path);
            return Err(error);
        }
        if let Err(source) = rename(&temporary_path, path) {
            let _ = fs::remove_file(&temporary_path);
            return Err(RotatorConfigError::Rename((
                temporary_path,
                path.to_path_buf(),
                source,
            )));
        }
        Ok(())
    }

    pub fn validate(&self) -> Result<(), RotatorConfigError> {
        let Self::Hamlib { hamlib } = self else {
            return Ok(());
        };
        hamlib
            .validate()
            .map_err(RotatorConfigError::InvalidDevice)?;
        let model = hamlib
            .model_id
            .parse::<hamlib::RotatorModelId>()
            .map_err(|_| {
                RotatorConfigError::InvalidDevice(HamlibDeviceConfigError::InvalidModelId(
                    hamlib.model_id.clone(),
                ))
            })?;
        let catalog = hamlib::RotatorCatalog::load().map_err(|error| {
            RotatorConfigError::InvalidValue("catalog".into(), error.to_string())
        })?;
        if catalog.model(model).is_none() {
            return Err(RotatorConfigError::UnknownModel(model));
        }
        let descriptors = catalog.describe_model(model).map_err(|error| {
            RotatorConfigError::InvalidValue("catalog".into(), error.to_string())
        })?;
        for (token, value) in &hamlib.token_values {
            let descriptor = descriptors
                .iter()
                .find(|descriptor| descriptor.token().as_str() == token)
                .ok_or_else(|| RotatorConfigError::UnknownToken(token.clone()))?;
            descriptor.parse_value(value).map_err(|error| {
                RotatorConfigError::InvalidValue(token.clone(), error.to_string())
            })?;
        }
        Ok(())
    }

    pub fn hamlib(&self) -> Option<&HamlibDeviceConfig> {
        match self {
            Self::Unconfigured => None,
            Self::Hamlib { hamlib } => Some(hamlib),
        }
    }
}
