use std::ffi::{OsStr, OsString};

// Native archives do not inherit Cargo's Rust optimization settings. Separate
// sections let the final linker discard unused native functions and data.
// Keep explicit caller flags last so toolchain overrides still take precedence.
pub fn native_size_flags(release: bool, windows: bool, caller_flags: &OsStr) -> OsString {
    if release {
        let mut flags = OsString::from("-Os -ffunction-sections ");
        // Splitting data saves space in ELF, but increases the measured PE file
        // size by placing much of its zero-fill storage in file-backed data.
        if !windows {
            flags.push("-fdata-sections ");
        }
        flags.push(caller_flags);
        flags
    } else {
        caller_flags.to_os_string()
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::{OsStr, OsString};

    use super::native_size_flags;

    #[test]
    fn release_flags_allow_caller_overrides() {
        assert_eq!(
            native_size_flags(
                true,
                false,
                OsStr::new("-O2 -ffile-prefix-map=/private=/src")
            ),
            OsString::from(
                "-Os -ffunction-sections -fdata-sections -O2 -ffile-prefix-map=/private=/src"
            )
        );
    }

    #[test]
    fn windows_release_does_not_split_zero_fill_data() {
        assert_eq!(
            native_size_flags(true, true, OsStr::new("-O2")),
            OsString::from("-Os -ffunction-sections -O2")
        );
    }

    #[test]
    fn debug_flags_are_unchanged() {
        assert_eq!(
            native_size_flags(false, false, OsStr::new("-g -O0")),
            OsString::from("-g -O0")
        );
        assert_eq!(
            native_size_flags(false, true, OsStr::new("")),
            OsString::new()
        );
    }

    #[cfg(unix)]
    #[test]
    fn preserves_non_utf8_caller_flags() {
        use std::os::unix::ffi::OsStrExt;

        let caller = OsStr::from_bytes(b"-I/source/\xff -O2");
        assert_eq!(
            native_size_flags(true, false, caller)
                .as_os_str()
                .as_bytes(),
            b"-Os -ffunction-sections -fdata-sections -I/source/\xff -O2"
        );
        assert_eq!(native_size_flags(false, false, caller), caller);
    }
}
