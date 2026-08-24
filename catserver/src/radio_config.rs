use std::{
    collections::BTreeMap,
    fmt,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

const CONFIG_FILE: &str = "config.json";
const SCHEMA_VERSION: u8 = 1;
pub const DEFAULT_RIGCTLD_HOST: &str = "127.0.0.1";
pub const DEFAULT_RIGCTLD_PORT: u16 = 4532;
type IoFailure = (PathBuf, std::io::Error);
type RenameFailure = (PathBuf, PathBuf, std::io::Error);

#[derive(Debug, Clone, Copy, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RadioBackendKind {
    Unconfigured,
    Omnirig,
    Rigctld,
    Hamlib,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum ActiveRadioBackend {
    Dummy,
    Configured(RadioBackendKind),
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
pub struct HamlibRigConfig {
    pub model_id: String,
    pub token_values: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
pub struct RigctldConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(tag = "backend", rename_all = "snake_case")]
pub enum RadioRigConfig {
    Unconfigured,
    Omnirig,
    Rigctld { rigctld: RigctldConfig },
    Hamlib { hamlib: HamlibRigConfig },
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
pub struct RadioConfig {
    pub rig1: RadioRigConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rig2: Option<RadioRigConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
#[serde(tag = "backend", rename_all = "snake_case")]
pub enum RotatorConfig {
    Rotctld {
        host: String,
        port: u16,
    },
    Rotctl {
        model_id: String,
        token_values: BTreeMap<String, String>,
    },
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum ActiveRotatorBackend {
    Dummy,
    Configured(RotatorConfig),
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub struct AppConfig {
    pub radio: RadioConfig,
    pub rotator: RotatorConfig,
}

#[derive(Debug)]
pub enum RadioConfigError {
    ProjectDirectories,
    CreateConfigDirectory(IoFailure),
    Read(IoFailure),
    Json(serde_json::Error),
    Serialize(serde_json::Error),
    UnsupportedVersion(u8),
    PlatformUnsupportedBackend(RadioBackendKind),
    InvalidModelId(String),
    InvalidToken(String),
    InvalidRigctldHost(String),
    InvalidRigctldPort,
    WriteTemporary(IoFailure),
    Rename(RenameFailure),
    InvalidRotatorHost,
    InvalidRotatorPort,
}

impl fmt::Display for RadioConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for RadioConfigError {}

#[derive(Deserialize, Serialize)]
struct PersistedAppConfig {
    version: u8,
    radio: RadioConfig,
    rotator: RotatorConfig,
}

impl RadioConfig {
    pub fn platform_default() -> Self {
        Self {
            rig1: RadioRigConfig::platform_default(),
            rig2: None,
        }
    }

    pub fn config_path() -> Result<PathBuf, RadioConfigError> {
        let project_dirs = ProjectDirs::from("org", "iarc", "holycluster")
            .ok_or(RadioConfigError::ProjectDirectories)?;
        Ok(project_dirs.config_dir().join(CONFIG_FILE))
    }

    pub fn load_from_path(path: &Path) -> Result<Self, RadioConfigError> {
        AppConfig::load_from_path(path).map(|config| config.radio)
    }

    pub fn save(&self) -> Result<(), RadioConfigError> {
        self.save_to_path(&Self::config_path()?)
    }

    pub fn save_to_path(&self, path: &Path) -> Result<(), RadioConfigError> {
        let mut config = AppConfig::load_from_path(path)?;
        config.radio = self.clone();
        config.save_to_path(path)
    }

    #[cfg(test)]
    pub(crate) fn save_to_path_with_rename(
        &self,
        path: &Path,
        rename: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
    ) -> Result<(), RadioConfigError> {
        let mut config = AppConfig::load_from_path(path)?;
        config.radio = self.clone();
        config.save_to_path_with_rename(path, rename)
    }

    pub fn effective_backend(&self, dummy: bool) -> ActiveRadioBackend {
        if dummy {
            ActiveRadioBackend::Dummy
        } else {
            ActiveRadioBackend::Configured(self.rig1.backend())
        }
    }

    pub(crate) fn validate(&self) -> Result<(), RadioConfigError> {
        self.rig1.validate()?;
        if let Some(rig2) = &self.rig2 {
            rig2.validate()?;
        }
        Ok(())
    }
}

impl RotatorConfig {
    pub fn platform_default() -> Self {
        Self::Rotctld {
            host: "localhost".into(),
            port: 4533,
        }
    }

    fn validate(&self) -> Result<(), RadioConfigError> {
        match self {
            Self::Rotctld { host, port } => {
                if host.trim().is_empty() {
                    return Err(RadioConfigError::InvalidRotatorHost);
                }
                if *port == 0 {
                    return Err(RadioConfigError::InvalidRotatorPort);
                }
            }
            Self::Rotctl {
                model_id,
                token_values,
            } => HamlibRigConfig {
                model_id: model_id.clone(),
                token_values: token_values.clone(),
            }
            .validate()?,
        }
        Ok(())
    }
}

impl AppConfig {
    pub fn platform_default() -> Self {
        Self {
            radio: RadioConfig::platform_default(),
            rotator: RotatorConfig::platform_default(),
        }
    }

    pub fn config_path() -> Result<PathBuf, RadioConfigError> {
        RadioConfig::config_path()
    }

    pub fn load_from_path(path: &Path) -> Result<Self, RadioConfigError> {
        let contents = match fs::read_to_string(path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::platform_default());
            }
            Err(source) => return Err(RadioConfigError::Read((path.to_path_buf(), source))),
        };
        let persisted: PersistedAppConfig =
            serde_json::from_str(&contents).map_err(RadioConfigError::Json)?;
        if persisted.version != SCHEMA_VERSION {
            return Err(RadioConfigError::UnsupportedVersion(persisted.version));
        }
        let config = Self {
            radio: persisted.radio,
            rotator: persisted.rotator,
        };
        config.validate()?;
        Ok(config)
    }

    pub fn save_to_path(&self, path: &Path) -> Result<(), RadioConfigError> {
        self.save_to_path_with_rename(path, |from, to| fs::rename(from, to))
    }

    pub(crate) fn save_to_path_with_rename(
        &self,
        path: &Path,
        rename: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
    ) -> Result<(), RadioConfigError> {
        self.validate()?;
        atomic_write(
            path,
            &PersistedAppConfig {
                version: SCHEMA_VERSION,
                radio: self.radio.clone(),
                rotator: self.rotator.clone(),
            },
            rename,
        )
    }

    pub fn effective_rotator(&self, dummy: bool) -> ActiveRotatorBackend {
        if dummy {
            ActiveRotatorBackend::Dummy
        } else {
            ActiveRotatorBackend::Configured(self.rotator.clone())
        }
    }

    fn validate(&self) -> Result<(), RadioConfigError> {
        self.radio.validate()?;
        self.rotator.validate()
    }
}

fn atomic_write<T: Serialize>(
    path: &Path,
    value: &T,
    rename: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), RadioConfigError> {
    let parent = path.parent().ok_or(RadioConfigError::ProjectDirectories)?;
    fs::create_dir_all(parent).map_err(|source| {
        RadioConfigError::CreateConfigDirectory((parent.to_path_buf(), source))
    })?;
    let temporary_path = path.with_extension("json.tmp");
    let serialized = serde_json::to_vec_pretty(value).map_err(RadioConfigError::Serialize)?;
    let write_result = File::create(&temporary_path)
        .and_then(|mut file| {
            file.write_all(&serialized)?;
            file.sync_all()
        })
        .map_err(|source| RadioConfigError::WriteTemporary((temporary_path.clone(), source)));
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }
    if let Err(source) = rename(&temporary_path, path) {
        let _ = fs::remove_file(&temporary_path);
        return Err(RadioConfigError::Rename((
            temporary_path,
            path.to_path_buf(),
            source,
        )));
    }
    Ok(())
}

impl RadioBackendKind {
    pub(crate) const fn is_supported_on_platform(self) -> bool {
        match self {
            Self::Unconfigured => true,
            Self::Hamlib => true,
            Self::Omnirig => cfg!(windows),
            Self::Rigctld => !cfg!(windows),
        }
    }
}

impl RadioRigConfig {
    fn platform_default() -> Self {
        Self::Unconfigured
    }

    pub const fn backend(&self) -> RadioBackendKind {
        match self {
            Self::Unconfigured => RadioBackendKind::Unconfigured,
            Self::Omnirig => RadioBackendKind::Omnirig,
            Self::Rigctld { .. } => RadioBackendKind::Rigctld,
            Self::Hamlib { .. } => RadioBackendKind::Hamlib,
        }
    }

    pub(crate) fn validate(&self) -> Result<(), RadioConfigError> {
        let backend = self.backend();
        if !backend.is_supported_on_platform() {
            return Err(RadioConfigError::PlatformUnsupportedBackend(backend));
        }
        match self {
            Self::Hamlib { hamlib } => hamlib.validate(),
            Self::Rigctld { rigctld } => rigctld.validate(),
            Self::Omnirig | Self::Unconfigured => Ok(()),
        }
    }
}

impl Default for RigctldConfig {
    fn default() -> Self {
        Self {
            host: DEFAULT_RIGCTLD_HOST.into(),
            port: DEFAULT_RIGCTLD_PORT,
        }
    }
}

impl RigctldConfig {
    fn validate(&self) -> Result<(), RadioConfigError> {
        if self.host.trim().is_empty() || self.host.chars().any(char::is_whitespace) {
            return Err(RadioConfigError::InvalidRigctldHost(self.host.clone()));
        }
        if self.port == 0 {
            return Err(RadioConfigError::InvalidRigctldPort);
        }
        Ok(())
    }
}

impl HamlibRigConfig {
    fn validate(&self) -> Result<(), RadioConfigError> {
        match self.model_id.parse::<u32>() {
            Ok(model_id) if model_id > 0 => {}
            _ => return Err(RadioConfigError::InvalidModelId(self.model_id.clone())),
        }
        for token in self.token_values.keys() {
            if !is_descriptor_token(token) {
                return Err(RadioConfigError::InvalidToken(token.clone()));
            }
        }
        Ok(())
    }
}

fn is_descriptor_token(token: &str) -> bool {
    let mut characters = token.chars();
    matches!(characters.next(), Some(character) if character.is_ascii_alphabetic())
        && characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}
