//! Narrow, fail-closed patch for the pinned 4.7.2 diagnostic implementation.
use std::{fs, io, path::Path};

use sha2::{Digest, Sha256};

const RIG_BEFORE: &str = include_str!("../patches/rig-diagnostics.before.c");
const RIG_AFTER: &str = include_str!("../patches/rig-diagnostics.after.c");
const HEADER_BEFORE: &str = include_str!("../patches/rig-debug.before.h");
const HEADER_AFTER: &str = include_str!("../patches/rig-debug.after.h");
const PATCHES: [(&str, &str, &str, &str); 2] = [
    (
        "src/rig.c",
        "47f570f6860ecaa7da2a09f1c5db89c52b628e814873b1d6d9c80c1e6494b47a",
        RIG_BEFORE,
        RIG_AFTER,
    ),
    (
        "include/hamlib/rig.h",
        "a2cfaedc3d92a641515ff58785db5bd1c30f62e562f63b8dadeee70202e000bd",
        HEADER_BEFORE,
        HEADER_AFTER,
    ),
];

fn unsupported() -> io::Error {
    io::Error::other(
        "unsupported Hamlib diagnostic source: use the managed pinned builder (unset HAMLIB_SOURCE_DIR), or provide the exact supported already-patched 4.7.2 source; caller-owned source is never patched automatically",
    )
}

fn transform(source: &str, hash: &str, before: &str, after: &str) -> io::Result<String> {
    if format!("{:x}", Sha256::digest(source.as_bytes())) != hash
        || source.matches(before).count() != 1
    {
        return Err(unsupported());
    }
    Ok(source.replacen(before, after, 1))
}

pub(crate) fn apply(source: &Path) -> io::Result<()> {
    // Validate both entire files before writing either; fresh extraction is required.
    let files = PATCHES
        .iter()
        .map(|(path, hash, before, after)| {
            let path = source.join(path);
            let patched = transform(&fs::read_to_string(&path)?, hash, before, after)?;
            Ok((path, patched))
        })
        .collect::<io::Result<Vec<_>>>()?;
    for (path, patched) in files {
        fs::write(path, patched)?;
    }
    Ok(())
}

fn validate_file(path: &Path, hash: &str, before: &str, after: &str) -> io::Result<()> {
    let patched = fs::read_to_string(path)?;
    if patched.matches(after).count() != 1 {
        return Err(unsupported());
    }
    let original = patched.replacen(after, before, 1);
    if transform(&original, hash, before, after)? != patched {
        return Err(unsupported());
    }
    Ok(())
}

pub(crate) fn validate_override(source: &Path) -> io::Result<()> {
    for (path, hash, before, after) in PATCHES {
        validate_file(&source.join(path), hash, before, after)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_native_source_and_override_validation() {
        // Use this build's real pinned source, not a small stand-in fixture.
        let source = option_env!("HAMLIB_SOURCE_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| Path::new(env!("OUT_DIR")).join("hamlib/source/hamlib-4.7.2"));
        let copy = tempfile::tempdir().unwrap();
        for (path, _, _, _) in PATCHES {
            let destination = copy.path().join(path);
            fs::create_dir_all(destination.parent().unwrap()).unwrap();
            fs::copy(source.join(path), destination).unwrap();
        }
        validate_override(copy.path()).unwrap();
        let patched: Vec<_> = PATCHES
            .iter()
            .map(|(path, _, _, _)| fs::read(copy.path().join(path)).unwrap())
            .collect();
        validate_override(copy.path()).unwrap();
        for ((path, _, _, _), expected) in PATCHES.iter().zip(&patched) {
            assert_eq!(&fs::read(copy.path().join(path)).unwrap(), expected);
        }
        for (path, _, before, after) in PATCHES {
            let file = copy.path().join(path);
            let pristine = fs::read_to_string(&file)
                .unwrap()
                .replacen(after, before, 1);
            fs::write(file, pristine).unwrap();
        }
        assert!(validate_override(copy.path()).is_err());
        let pristine_rig = fs::read(copy.path().join("src/rig.c")).unwrap();
        assert!(validate_override(copy.path()).is_err());
        assert_eq!(
            fs::read(copy.path().join("src/rig.c")).unwrap(),
            pristine_rig
        );
        apply(copy.path()).unwrap();
        validate_override(copy.path()).unwrap();
        for ((path, _, _, _), expected) in PATCHES.iter().zip(&patched) {
            assert_eq!(&fs::read(copy.path().join(path)).unwrap(), expected);
        }
    }

    #[test]
    fn rejects_unsupported_source_without_writing() {
        let source = tempfile::tempdir().unwrap();
        fs::create_dir_all(source.path().join("src")).unwrap();
        fs::write(source.path().join("src/rig.c"), "unsupported").unwrap();
        assert!(apply(source.path()).is_err());
        assert!(validate_override(source.path()).is_err());
        assert_eq!(
            fs::read_to_string(source.path().join("src/rig.c")).unwrap(),
            "unsupported"
        );
    }

    #[test]
    fn override_validation_accepts_only_exact_patch_without_mutation() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("rig.c");
        let original = format!("prefix{RIG_BEFORE}suffix");
        let hash = format!("{:x}", Sha256::digest(original.as_bytes()));
        fs::write(&path, &original).unwrap();
        assert!(validate_file(&path, &hash, RIG_BEFORE, RIG_AFTER).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
        let patched = transform(&original, &hash, RIG_BEFORE, RIG_AFTER).unwrap();
        fs::write(&path, &patched).unwrap();
        validate_file(&path, &hash, RIG_BEFORE, RIG_AFTER).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), patched);
        let modified = format!("{patched}\n");
        fs::write(&path, &modified).unwrap();
        assert!(validate_file(&path, &hash, RIG_BEFORE, RIG_AFTER).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), modified);
    }

    #[test]
    fn exact_transform_and_source_drift_rejection() {
        let original = format!("prefix{RIG_BEFORE}suffix");
        let hash = format!("{:x}", Sha256::digest(original.as_bytes()));
        assert_eq!(
            transform(&original, &hash, RIG_BEFORE, RIG_AFTER).unwrap(),
            format!("prefix{RIG_AFTER}suffix")
        );
        assert!(transform(&format!("{original}\n"), &hash, RIG_BEFORE, RIG_AFTER).is_err());
        assert!(transform(&original, &hash, "missing", RIG_AFTER).is_err());
        let duplicate = format!("{RIG_BEFORE}{RIG_BEFORE}");
        let hash = format!("{:x}", Sha256::digest(duplicate.as_bytes()));
        assert!(transform(&duplicate, &hash, RIG_BEFORE, RIG_AFTER).is_err());
    }
}
