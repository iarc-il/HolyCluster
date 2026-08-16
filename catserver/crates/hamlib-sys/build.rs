use std::{env, path::Path, process::Command};

const HAMLIB_VERSION: &str = "4.7.2";

fn main() {
    for variable in [
        "DEP_HAMLIB_SRC_VERSION",
        "DEP_HAMLIB_SRC_INCLUDE",
        "DEP_HAMLIB_SRC_LIBDIR",
        "DEP_HAMLIB_SRC_LIBRARY_FILE",
        "DEP_HAMLIB_SRC_LIBUSB_INCLUDE",
        "DEP_HAMLIB_SRC_LIBUSB_LIBDIR",
        "DEP_HAMLIB_SRC_LIBUSB_ARTIFACT",
        "TARGET",
    ] {
        println!("cargo:rerun-if-env-changed={variable}");
    }

    let version = required("DEP_HAMLIB_SRC_VERSION");
    assert_eq!(version, HAMLIB_VERSION, "unsupported Hamlib header version");
    let include_dir = required("DEP_HAMLIB_SRC_INCLUDE");
    let target = required("TARGET");
    let lib_dir = required("DEP_HAMLIB_SRC_LIBDIR");
    let library = Path::new(&lib_dir).join(required("DEP_HAMLIB_SRC_LIBRARY_FILE"));
    assert!(
        library.is_file(),
        "Hamlib static archive is missing: {library:?}"
    );
    println!("cargo:rustc-link-search=native={}", lib_dir);
    println!("cargo:rustc-link-lib=static=hamlib");
    if target == "x86_64-pc-windows-gnu" {
        let libusb_include = required("DEP_HAMLIB_SRC_LIBUSB_INCLUDE");
        assert!(
            Path::new(&libusb_include)
                .join("libusb-1.0/libusb.h")
                .is_file(),
            "libusb header is missing from {libusb_include}"
        );
        println!(
            "cargo:rustc-link-search=native={}",
            required("DEP_HAMLIB_SRC_LIBUSB_LIBDIR")
        );
        let libusb = required("DEP_HAMLIB_SRC_LIBUSB_ARTIFACT");
        assert_static_archive(Path::new(&libusb), "libusb");
        println!(
            "cargo:rustc-link-search=native={}",
            target_library_directory("libwinpthread.a")
        );
        println!("cargo:rustc-link-lib=static=usb-1.0");
        println!("cargo:rustc-link-lib=static=winpthread");
        for library in [
            "advapi32", "cfgmgr32", "iphlpapi", "ole32", "setupapi", "user32", "winmm", "ws2_32",
        ] {
            println!("cargo:rustc-link-lib=dylib={library}");
        }
    }
    if target.contains("linux") {
        pkg_config::Config::new()
            .probe("libusb-1.0")
            .expect("Hamlib's static host build requires libusb-1.0");
        println!("cargo:rustc-link-lib=dylib=dl");
        println!("cargo:rustc-link-lib=dylib=m");
    }
    cc::Build::new()
        .file("src/caps_metadata.c")
        .file("src/debug.c")
        .include(include_dir)
        .compile("hamlib_sys_caps_metadata");
}

fn assert_static_archive(path: &Path, name: &str) {
    let bytes = std::fs::read(path)
        .unwrap_or_else(|error| panic!("{name} static archive is missing at {path:?}: {error}"));
    assert!(
        bytes.starts_with(b"!<arch>\n"),
        "{name} archive is not a static ar archive: {path:?}"
    );
}

fn required(name: &str) -> String {
    env::var(name).unwrap_or_else(|_| panic!("missing Hamlib source metadata {name}"))
}

fn target_library_directory(name: &str) -> String {
    let output = Command::new("x86_64-w64-mingw32-gcc")
        .arg(format!("-print-file-name={name}"))
        .output()
        .unwrap_or_else(|error| panic!("failed to locate {name}: {error}"));
    assert!(output.status.success(), "failed to locate {name}");
    let path = String::from_utf8(output.stdout)
        .unwrap_or_else(|error| panic!("invalid target compiler output for {name}: {error}"));
    let path = Path::new(path.trim());
    assert!(
        path.is_file(),
        "target runtime archive is missing: {path:?}"
    );
    path.parent()
        .unwrap_or_else(|| panic!("target runtime archive has no parent: {path:?}"))
        .display()
        .to_string()
}
