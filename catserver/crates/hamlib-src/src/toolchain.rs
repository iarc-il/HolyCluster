use thiserror::Error;

pub const MINGW_TOOLCHAIN: [(&str, &str); 6] = [
    ("CC", "x86_64-w64-mingw32-gcc"),
    ("CXX", "x86_64-w64-mingw32-g++"),
    ("AR", "x86_64-w64-mingw32-ar"),
    ("RANLIB", "x86_64-w64-mingw32-ranlib"),
    ("DLLTOOL", "x86_64-w64-mingw32-dlltool"),
    ("WINDRES", "x86_64-w64-mingw32-windres"),
];

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ToolchainError {
    #[error("configured MinGW toolchain is missing {0}")]
    MissingVariable(&'static str),
    #[error("configured MinGW toolchain has {variable}={actual}, expected {expected}")]
    WrongValue {
        variable: &'static str,
        actual: String,
        expected: &'static str,
    },
}

pub fn validate_mingw_toolchain(config: &str) -> Result<(), ToolchainError> {
    for (environment_name, expected) in MINGW_TOOLCHAIN {
        let recorded_name = match environment_name {
            "WINDRES" => "RC",
            name => name,
        };
        let actual = config_value(config, recorded_name)
            .ok_or(ToolchainError::MissingVariable(environment_name))?;
        let matches = match environment_name {
            "CXX" => actual == expected || actual.starts_with(&format!("{expected} ")),
            _ => actual == expected,
        };
        if !matches {
            return Err(ToolchainError::WrongValue {
                variable: environment_name,
                actual: actual.to_owned(),
                expected,
            });
        }
    }
    Ok(())
}

fn config_value<'a>(config: &'a str, variable: &str) -> Option<&'a str> {
    let prefix = format!("{variable}='");
    config
        .lines()
        .find_map(|line| line.strip_prefix(&prefix)?.strip_suffix('\''))
}
