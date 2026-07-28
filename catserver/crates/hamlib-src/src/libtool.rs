use std::path::Path;

use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum LibtoolError {
    #[error("libtool metadata is missing {0}")]
    MissingField(&'static str),
    #[error("libtool metadata has no Windows import archive")]
    MissingImportLibrary,
    #[error("libtool 2.5.4 MinGW naming contract is not configured")]
    InvalidNamingContract,
    #[error("installed libtool metadata has an ambiguous libusb dependency path")]
    AmbiguousLibusbDependency,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LibtoolMetadata {
    dlname: String,
    import_name: String,
}

impl LibtoolMetadata {
    pub fn runtime_name(&self) -> &str {
        &self.dlname
    }

    pub fn import_name(&self) -> &str {
        &self.import_name
    }
}

pub fn parse_libtool_metadata(contents: &str) -> Result<LibtoolMetadata, LibtoolError> {
    let dlname = quoted_value(contents, "dlname").ok_or(LibtoolError::MissingField("dlname"))?;
    if dlname.is_empty() {
        return Err(LibtoolError::MissingField("dlname"));
    }
    let library_names = quoted_value(contents, "library_names")
        .ok_or(LibtoolError::MissingField("library_names"))?;
    let import_name = library_names
        .split_whitespace()
        .find(|name| name.ends_with(".dll.a") || name.ends_with(".lib"))
        .ok_or(LibtoolError::MissingImportLibrary)?;
    Ok(LibtoolMetadata {
        dlname: dlname.to_owned(),
        import_name: import_name.to_owned(),
    })
}

pub fn validate_windows_naming(libtool: &str) -> Result<(), LibtoolError> {
    let valid = libtool.contains("macro_version=2.5.4")
        && libtool.contains("build_libtool_libs=yes")
        && libtool.contains("library_names_spec=\"")
        && (libtool.contains(".dll.a\"") || libtool.contains(".lib\""))
        && libtool.contains("soname_spec=\"\\$libname");
    if valid {
        Ok(())
    } else {
        Err(LibtoolError::InvalidNamingContract)
    }
}

pub fn normalize_libusb_dependency_paths(
    contents: &str,
    libusb_dir: &Path,
) -> Result<String, LibtoolError> {
    let libusb_dir = libusb_dir.to_string_lossy();
    let link_token = format!("-L{libusb_dir}");
    let archive_token = format!("{libusb_dir}/libusb-1.0.la");
    let line = contents
        .lines()
        .find(|line| line.starts_with("dependency_libs='"))
        .ok_or(LibtoolError::MissingField("dependency_libs"))?;
    let value = line
        .strip_prefix("dependency_libs='")
        .and_then(|value| value.strip_suffix('\''))
        .ok_or(LibtoolError::MissingField("dependency_libs"))?;
    let link_count = value
        .split_whitespace()
        .filter(|token| *token == link_token)
        .count();
    let archive_count = value
        .split_whitespace()
        .filter(|token| *token == archive_token)
        .count();
    if link_count != 1 || archive_count != 1 {
        return Err(LibtoolError::AmbiguousLibusbDependency);
    }
    let mut tokens = value
        .split_whitespace()
        .filter(|token| *token != link_token && *token != archive_token)
        .collect::<Vec<_>>();
    if !tokens.contains(&"-lusb-1.0") {
        let position = tokens
            .iter()
            .position(|token| *token == "-lws2_32")
            .unwrap_or(tokens.len());
        tokens.insert(position + usize::from(position < tokens.len()), "-lusb-1.0");
    }
    let replacement = format!("dependency_libs=' {}'", tokens.join(" "));
    Ok(contents.replacen(line, &replacement, 1))
}

pub fn sanitize_installed_metadata_paths(contents: &str, prefix: &Path) -> String {
    let installed_libdir = format!("libdir='{}/lib'", prefix.display());
    contents.replace(&installed_libdir, "libdir='lib'")
}

fn quoted_value<'a>(contents: &'a str, key: &str) -> Option<&'a str> {
    let prefix = format!("{key}='");
    contents
        .lines()
        .find_map(|line| line.strip_prefix(&prefix)?.strip_suffix('\''))
}
