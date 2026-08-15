use std::{
    collections::BTreeMap,
    fmt,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

const CONFIG_FILE: &str = "radio.json";
const SCHEMA_VERSION: u8 = 2;
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

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct RigctldConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Deserialize)]
struct SerializedRigctldConfig {
    host: Option<String>,
    port: Option<u16>,
}

impl<'de> Deserialize<'de> for RigctldConfig {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let config = SerializedRigctldConfig::deserialize(deserializer)?;
        Ok(Self {
            host: config.host.unwrap_or_else(|| DEFAULT_RIGCTLD_HOST.into()),
            port: config.port.unwrap_or(DEFAULT_RIGCTLD_PORT),
        })
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
pub struct RadioRigConfig {
    pub backend: RadioBackendKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hamlib: Option<HamlibRigConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rigctld: Option<RigctldConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
pub struct RadioConfig {
    pub rig1: RadioRigConfig,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rig2: Option<RadioRigConfig>,
}

#[derive(Debug)]
pub enum RadioConfigError {
    ProjectDirectories,
    CreateConfigDirectory(IoFailure),
    Read(IoFailure),
    Json(serde_json::Error),
    Serialize(serde_json::Error),
    UnsupportedVersion(u8),
    UnknownBackend(String),
    PlatformUnsupportedBackend(RadioBackendKind),
    MissingBackendConfiguration(RadioBackendKind),
    UnexpectedBackendConfiguration,
    InvalidModelId(String),
    InvalidToken(String),
    InvalidRigctldHost(String),
    InvalidRigctldPort,
    WriteTemporary(IoFailure),
    Rename(RenameFailure),
}

impl fmt::Display for RadioConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for RadioConfigError {}

#[derive(Deserialize)]
struct ConfigHeader {
    version: u8,
}

#[derive(Deserialize)]
pub(crate) struct LegacyRadioConfig {
    pub(crate) backend: String,
    #[serde(default)]
    pub(crate) hamlib: Option<LegacyHamlibConfig>,
}

#[derive(Deserialize)]
pub(crate) struct LegacyHamlibConfig {
    pub(crate) rig1: HamlibRigConfig,
    #[serde(default)]
    pub(crate) rig2: Option<HamlibRigConfig>,
}

#[derive(Serialize)]
struct PersistedConfig<'a> {
    version: u8,
    #[serde(flatten)]
    config: &'a RadioConfig,
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
        let contents = match fs::read_to_string(path) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::platform_default());
            }
            Err(source) => return Err(RadioConfigError::Read((path.to_path_buf(), source))),
        };
        let header: ConfigHeader =
            serde_json::from_str(&contents).map_err(RadioConfigError::Json)?;
        let config = match header.version {
            1 => {
                Self::from_legacy(serde_json::from_str(&contents).map_err(RadioConfigError::Json)?)?
            }
            SCHEMA_VERSION => serde_json::from_str(&contents).map_err(RadioConfigError::Json)?,
            version => return Err(RadioConfigError::UnsupportedVersion(version)),
        };
        config.validate()?;
        Ok(config)
    }

    pub fn save(&self) -> Result<(), RadioConfigError> {
        self.save_to_path(&Self::config_path()?)
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
        let parent = path.parent().ok_or(RadioConfigError::ProjectDirectories)?;
        fs::create_dir_all(parent).map_err(|source| {
            RadioConfigError::CreateConfigDirectory((parent.to_path_buf(), source))
        })?;
        let temporary_path = path.with_extension("json.tmp");
        let serialized =
            serde_json::to_vec_pretty(&self.persisted()).map_err(RadioConfigError::Serialize)?;
        let write_result = File::create(&temporary_path)
            .and_then(|mut temporary| {
                temporary.write_all(&serialized)?;
                temporary.sync_all()
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

    pub fn effective_backend(&self, dummy: bool) -> ActiveRadioBackend {
        if dummy {
            ActiveRadioBackend::Dummy
        } else {
            ActiveRadioBackend::Configured(self.rig1.backend)
        }
    }

    pub(crate) fn from_legacy(config: LegacyRadioConfig) -> Result<Self, RadioConfigError> {
        let backend = match config.backend.as_str() {
            "unconfigured" => RadioBackendKind::Unconfigured,
            "omnirig" => RadioBackendKind::Omnirig,
            "rigctld" => RadioBackendKind::Rigctld,
            "hamlib" => RadioBackendKind::Hamlib,
            _ => return Err(RadioConfigError::UnknownBackend(config.backend)),
        };
        let (rig1, rig2) = match backend {
            RadioBackendKind::Unconfigured => (
                RadioRigConfig {
                    backend: RadioBackendKind::Unconfigured,
                    hamlib: None,
                    rigctld: None,
                },
                None,
            ),
            RadioBackendKind::Hamlib => {
                let hamlib = config
                    .hamlib
                    .ok_or(RadioConfigError::MissingBackendConfiguration(backend))?;
                (
                    RadioRigConfig::hamlib(hamlib.rig1),
                    hamlib.rig2.map(RadioRigConfig::hamlib),
                )
            }
            RadioBackendKind::Rigctld => (RadioRigConfig::rigctld_default(), None),
            RadioBackendKind::Omnirig => (RadioRigConfig::omnirig(), None),
        };
        Ok(Self { rig1, rig2 })
    }

    fn persisted(&self) -> PersistedConfig<'_> {
        PersistedConfig {
            version: SCHEMA_VERSION,
            config: self,
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

impl RadioBackendKind {
    const fn is_supported_on_platform(self) -> bool {
        match self {
            Self::Unconfigured => true,
            Self::Hamlib => true,
            Self::Omnirig => cfg!(windows),
            Self::Rigctld => !cfg!(windows),
        }
    }
}

impl RadioRigConfig {
    pub fn hamlib(hamlib: HamlibRigConfig) -> Self {
        Self {
            backend: RadioBackendKind::Hamlib,
            hamlib: Some(hamlib),
            rigctld: None,
        }
    }

    pub fn rigctld_default() -> Self {
        Self {
            backend: RadioBackendKind::Rigctld,
            hamlib: None,
            rigctld: Some(RigctldConfig::default()),
        }
    }

    pub fn omnirig() -> Self {
        Self {
            backend: RadioBackendKind::Omnirig,
            hamlib: None,
            rigctld: None,
        }
    }

    fn platform_default() -> Self {
        Self {
            backend: RadioBackendKind::Unconfigured,
            hamlib: None,
            rigctld: None,
        }
    }

    pub(crate) fn validate(&self) -> Result<(), RadioConfigError> {
        if !self.backend.is_supported_on_platform() {
            return Err(RadioConfigError::PlatformUnsupportedBackend(self.backend));
        }
        match (&self.backend, &self.hamlib, &self.rigctld) {
            (RadioBackendKind::Hamlib, Some(hamlib), None) => hamlib.validate(),
            (RadioBackendKind::Rigctld, None, Some(rigctld)) => rigctld.validate(),
            (RadioBackendKind::Omnirig, None, None) => Ok(()),
            (RadioBackendKind::Unconfigured, None, None) => Ok(()),
            (backend, None, _) => Err(RadioConfigError::MissingBackendConfiguration(*backend)),
            _ => Err(RadioConfigError::UnexpectedBackendConfiguration),
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
