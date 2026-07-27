use std::{env, path::Path};

const HAMLIB_VERSION: &str = "4.7.2";

fn main() {
    for variable in [
        "DEP_HAMLIB_SRC_VERSION",
        "DEP_HAMLIB_SRC_INCLUDE",
        "DEP_HAMLIB_SRC_LIBDIR",
        "DEP_HAMLIB_SRC_LIBRARY_FILE",
        "DEP_HAMLIB_SRC_IMPORT_LIBRARY",
        "DEP_HAMLIB_SRC_RUNTIME_LIBRARY",
        "TARGET",
    ] {
        println!("cargo:rerun-if-env-changed={variable}");
    }

    let version = required("DEP_HAMLIB_SRC_VERSION");
    assert_eq!(version, HAMLIB_VERSION, "unsupported Hamlib header version");
    let include_dir = required("DEP_HAMLIB_SRC_INCLUDE");
    let target = required("TARGET");
    let library = if target == "x86_64-pc-windows-gnu" {
        required("DEP_HAMLIB_SRC_IMPORT_LIBRARY")
    } else {
        required("DEP_HAMLIB_SRC_LIBRARY_FILE")
    };
    let library = Path::new(&library);
    if target == "x86_64-pc-windows-gnu" {
        assert!(
            library.is_file(),
            "Hamlib import archive is missing: {library:?}"
        );
    }
    println!(
        "cargo:rustc-link-search=native={}",
        required("DEP_HAMLIB_SRC_LIBDIR")
    );
    println!(
        "cargo:rustc-link-lib={}=hamlib",
        if target == "x86_64-pc-windows-gnu" {
            "dylib"
        } else {
            "static"
        }
    );
    if target.contains("linux") {
        pkg_config::Config::new()
            .probe("libusb-1.0")
            .expect("Hamlib's static host build requires libusb-1.0");
        println!("cargo:rustc-link-lib=dylib=dl");
        println!("cargo:rustc-link-lib=dylib=m");
    }
    cc::Build::new()
        .file("src/caps_metadata.c")
        .include(include_dir)
        .compile("hamlib_sys_caps_metadata");
}

fn required(name: &str) -> String {
    env::var(name).unwrap_or_else(|_| panic!("missing Hamlib source metadata {name}"))
}
