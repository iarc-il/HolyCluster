use hamlib_src::{LibtoolError, ToolchainError, parse_libtool_metadata, validate_mingw_toolchain};
use std::path::Path;

#[test]
fn rejects_gcc_as_the_mingw_cxx_frontend() {
    let config = "CC='x86_64-w64-mingw32-gcc'\nCXX='x86_64-w64-mingw32-gcc'\nAR='x86_64-w64-mingw32-ar'\nRANLIB='x86_64-w64-mingw32-ranlib'\nDLLTOOL='x86_64-w64-mingw32-dlltool'\nRC='x86_64-w64-mingw32-windres'\n";

    assert!(matches!(
        validate_mingw_toolchain(config),
        Err(ToolchainError::WrongValue {
            variable: "CXX",
            ..
        })
    ));
}

#[test]
fn rejects_an_incomplete_mingw_toolchain_contract() {
    let config = "CC='x86_64-w64-mingw32-gcc'\nCXX='x86_64-w64-mingw32-g++'\nAR='x86_64-w64-mingw32-ar'\nRANLIB='x86_64-w64-mingw32-ranlib'\nDLLTOOL='x86_64-w64-mingw32-dlltool'\n";

    assert!(matches!(
        validate_mingw_toolchain(config),
        Err(ToolchainError::MissingVariable("WINDRES"))
    ));
}

#[test]
fn parses_distinct_runtime_and_import_roles_from_libtool_metadata() {
    let metadata = parse_libtool_metadata(
        "dlname='libhamlib-4.dll'\nlibrary_names='libhamlib-4.dll libhamlib.dll.a'\nold_library=''\n",
    )
    .unwrap();

    assert_eq!(metadata.runtime_name(), "libhamlib-4.dll");
    assert_eq!(metadata.import_name(), "libhamlib.dll.a");
}

#[test]
fn parses_libtool_lib_import_roles() {
    let metadata = parse_libtool_metadata(
        "dlname='libhamlib-4.dll'\nlibrary_names='libhamlib-4.dll libhamlib.lib'\nold_library=''\n",
    )
    .unwrap();

    assert_eq!(metadata.runtime_name(), "libhamlib-4.dll");
    assert_eq!(metadata.import_name(), "libhamlib.lib");
}

#[test]
fn rejects_libtool_metadata_without_an_import_archive() {
    assert!(matches!(
        parse_libtool_metadata(
            "dlname='libhamlib-4.dll'\nlibrary_names='libhamlib-4.dll'\nold_library=''\n"
        ),
        Err(LibtoolError::MissingImportLibrary)
    ));
}

#[test]
fn removes_only_the_configured_libusb_paths_from_dependency_metadata() {
    let input = "dlname='../bin/libhamlib-4.dll'\ndependency_libs=' -L/tmp/qa/lib -lws2_32 /tmp/qa/lib/libusb-1.0.la -lwinmm'\n";

    let normalized =
        hamlib_src::normalize_libusb_dependency_paths(input, Path::new("/tmp/qa/lib")).unwrap();

    assert!(normalized.contains("dependency_libs=' -lws2_32 -lusb-1.0 -lwinmm'"));
    assert!(normalized.contains("dlname='../bin/libhamlib-4.dll'"));
    assert!(!normalized.contains("/tmp/qa/lib"));
}

#[test]
fn removes_the_installed_prefix_from_libdir_metadata() {
    let input = "libdir='/tmp/qa/prefix/lib'\n";

    let sanitized =
        hamlib_src::sanitize_installed_metadata_paths(input, Path::new("/tmp/qa/prefix"));

    assert_eq!(sanitized, "libdir='lib'\n");
    assert!(!sanitized.contains("/tmp/qa"));
}
