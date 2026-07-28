use std::path::{Path, PathBuf};

pub(crate) fn resolve_cargo_target_dir(
    out_dir: &Path,
    target: &str,
    configured: Option<&Path>,
    current_dir: &Path,
) -> Result<PathBuf, &'static str> {
    if let Some(configured) = configured {
        return Ok(if configured.is_absolute() {
            configured.to_path_buf()
        } else {
            current_dir.join(configured)
        });
    }

    let build = out_dir
        .parent()
        .and_then(Path::parent)
        .filter(|path| path.file_name().is_some_and(|name| name == "build"))
        .ok_or("OUT_DIR build directory")?;
    let profile = build.parent().ok_or("OUT_DIR profile directory")?;
    let parent = profile.parent().ok_or("OUT_DIR target root")?;
    if parent.file_name().is_some_and(|name| name == target) {
        parent
            .parent()
            .map(Path::to_path_buf)
            .ok_or("OUT_DIR target root")
    } else {
        Ok(parent.to_path_buf())
    }
}

#[cfg(test)]
mod tests {
    use super::resolve_cargo_target_dir;
    use std::path::{Path, PathBuf};

    #[test]
    fn derives_default_target_root_from_out_dir() {
        let result = resolve_cargo_target_dir(
            Path::new("/workspace/target/debug/build/hamlib-src/out"),
            "x86_64-unknown-linux-gnu",
            None,
            Path::new("/workspace"),
        );

        assert_eq!(result, Ok(PathBuf::from("/workspace/target")));
    }

    #[test]
    fn preserves_absolute_arbitrary_target_dir() {
        let result = resolve_cargo_target_dir(
            Path::new("/ignored/out"),
            "x86_64-unknown-linux-gnu",
            Some(Path::new("/qa/cargo-output")),
            Path::new("/workspace"),
        );

        assert_eq!(result, Ok(PathBuf::from("/qa/cargo-output")));
    }

    #[test]
    fn resolves_relative_arbitrary_target_dir_against_cwd() {
        let result = resolve_cargo_target_dir(
            Path::new("/ignored/out"),
            "x86_64-unknown-linux-gnu",
            Some(Path::new("cargo-output")),
            Path::new("/workspace"),
        );

        assert_eq!(result, Ok(PathBuf::from("/workspace/cargo-output")));
    }

    #[test]
    fn preserves_nested_arbitrary_target_dir() {
        let result = resolve_cargo_target_dir(
            Path::new("/ignored/out"),
            "x86_64-unknown-linux-gnu",
            Some(Path::new("qa/cargo/output")),
            Path::new("/workspace"),
        );

        assert_eq!(result, Ok(PathBuf::from("/workspace/qa/cargo/output")));
    }

    #[test]
    fn preserves_arbitrary_path_containing_target_component() {
        let result = resolve_cargo_target_dir(
            Path::new("/ignored/out"),
            "x86_64-unknown-linux-gnu",
            Some(Path::new("qa/target-like-output")),
            Path::new("/workspace"),
        );

        assert_eq!(
            result,
            Ok(PathBuf::from("/workspace/qa/target-like-output"))
        );
    }
}
