use std::{
    collections::BTreeMap,
    fmt,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

use crate::hamlib_device_config::{HamlibDeviceConfig, HamlibDeviceConfigError};

const CONFIG_FILE: &str = "radio.json";
const SCHEMA_VERSION: u8 = 3;
type IoFailure = (PathBuf, std::io::Error);
type RenameFailure = (PathBuf, PathBuf, std::io::Error);

#[derive(Debug, Clone, Copy, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RadioBackendKind {
    Unconfigured,
    Omnirig,
    Hamlib,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum ActiveRadioBackend {
    Dummy,
    Configured(RadioBackendKind),
}

pub type HamlibRigConfig = HamlibDeviceConfig;

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
pub struct RadioRigConfig {
    pub model_id: String,
    pub token_values: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Eq, PartialEq)]
pub struct RadioConfig {
    pub rig: Option<RadioRigConfig>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum OmniRigSlot {
    Rig1,
    Rig2,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum ResolvedRadioModel {
    Hamlib(hamlib::RigModelId),
    Omnirig(OmniRigSlot),
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
    PlatformUnsupportedModel(String),
    InvalidModelId(String),
    InvalidToken(String),
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

#[derive(Serialize)]
struct PersistedConfig<'a> {
    version: u8,
    #[serde(flatten)]
    config: &'a RadioConfig,
}

pub fn resolve_model_id(model_id: &str) -> Result<ResolvedRadioModel, RadioConfigError> {
    let Some((prefix, id)) = model_id.split_once(':') else {
        return Err(RadioConfigError::InvalidModelId(model_id.into()));
    };
    match prefix {
        "hamlib" => match id.parse::<u32>() {
            Ok(id) if id > 0 => Ok(ResolvedRadioModel::Hamlib(hamlib::RigModelId::new(id))),
            _ => Err(RadioConfigError::InvalidModelId(model_id.into())),
        },
        "omnirig" => match id {
            "1" => Ok(ResolvedRadioModel::Omnirig(OmniRigSlot::Rig1)),
            "2" => Ok(ResolvedRadioModel::Omnirig(OmniRigSlot::Rig2)),
            _ => Err(RadioConfigError::InvalidModelId(model_id.into())),
        },
        _ => Err(RadioConfigError::InvalidModelId(model_id.into())),
    }
}

impl RadioConfig {
    pub fn platform_default() -> Self {
        Self { rig: None }
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
        if matches!(header.version, 1 | 2) {
            return Ok(Self::platform_default());
        }
        if header.version != SCHEMA_VERSION {
            return Err(RadioConfigError::UnsupportedVersion(header.version));
        }
        let config: Self = serde_json::from_str(&contents).map_err(RadioConfigError::Json)?;
        config.validate()?;
        Ok(config)
    }

    pub fn save(&self) -> Result<(), RadioConfigError> {
        self.save_to_path(&Self::config_path()?)
    }

    pub fn save_to_path(&self, path: &Path) -> Result<(), RadioConfigError> {
        self.save_to_path_with_rename(path, replace_file)
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
            ActiveRadioBackend::Configured(self.backend())
        }
    }

    pub(crate) fn backend(&self) -> RadioBackendKind {
        self.rig
            .as_ref()
            .map_or(RadioBackendKind::Unconfigured, RadioRigConfig::backend)
    }

    fn persisted(&self) -> PersistedConfig<'_> {
        PersistedConfig {
            version: SCHEMA_VERSION,
            config: self,
        }
    }

    pub(crate) fn validate(&self) -> Result<(), RadioConfigError> {
        if let Some(rig) = &self.rig {
            rig.validate()?;
        }
        Ok(())
    }
}

impl RadioRigConfig {
    pub fn backend(&self) -> RadioBackendKind {
        match resolve_model_id(&self.model_id) {
            Ok(ResolvedRadioModel::Hamlib(_)) => RadioBackendKind::Hamlib,
            Ok(ResolvedRadioModel::Omnirig(_)) => RadioBackendKind::Omnirig,
            Err(_) => RadioBackendKind::Unconfigured,
        }
    }

    pub(crate) fn validate(&self) -> Result<(), RadioConfigError> {
        let resolved = resolve_model_id(&self.model_id)?;
        if matches!(resolved, ResolvedRadioModel::Omnirig(_)) && !cfg!(windows) {
            return Err(RadioConfigError::PlatformUnsupportedModel(
                self.model_id.clone(),
            ));
        }
        for token in self.token_values.keys() {
            if !is_descriptor_token(token) {
                return Err(RadioConfigError::InvalidToken(token.clone()));
            }
        }
        Ok(())
    }

    pub(crate) fn hamlib_config(&self) -> Option<HamlibRigConfig> {
        match resolve_model_id(&self.model_id).ok()? {
            ResolvedRadioModel::Hamlib(model_id) => Some(HamlibRigConfig {
                model_id: model_id.to_string(),
                token_values: self.token_values.clone(),
            }),
            ResolvedRadioModel::Omnirig(_) => None,
        }
    }
}

fn is_descriptor_token(token: &str) -> bool {
    let mut characters = token.chars();
    matches!(characters.next(), Some(character) if character.is_ascii_alphabetic())
        && characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    let from = from
        .to_str()
        .ok_or_else(|| std::io::Error::other("temporary config path is not valid Unicode"))?;
    let to = to
        .to_str()
        .ok_or_else(|| std::io::Error::other("config path is not valid Unicode"))?;
    winsafe::MoveFileEx(
        from,
        Some(to),
        winsafe::co::MOVEFILE::REPLACE_EXISTING | winsafe::co::MOVEFILE::WRITE_THROUGH,
    )
    .map_err(|error| std::io::Error::from_raw_os_error(error.raw() as i32))
}

impl From<HamlibDeviceConfigError> for RadioConfigError {
    fn from(error: HamlibDeviceConfigError) -> Self {
        match error {
            HamlibDeviceConfigError::InvalidModelId(model) => Self::InvalidModelId(model),
            HamlibDeviceConfigError::InvalidToken(token) => Self::InvalidToken(token),
        }
    }
}
