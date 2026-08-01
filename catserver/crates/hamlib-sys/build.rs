use std::{env, path::Path};

const HAMLIB_VERSION: &str = "4.7.2";

fn main() {
    for variable in [
        "DEP_HAMLIB_SRC_VERSION",
        "DEP_HAMLIB_SRC_INCLUDE",
        "DEP_HAMLIB_SRC_LIBDIR",
        "DEP_HAMLIB_SRC_LIBRARY_FILE",
        "HAMLIB_LIBUSB_LIB_DIR",
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
        println!(
            "cargo:rustc-link-search=native={}",
            required("HAMLIB_LIBUSB_LIB_DIR")
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
        .include(include_dir)
        .compile("hamlib_sys_caps_metadata");
}

fn required(name: &str) -> String {
    env::var(name).unwrap_or_else(|_| panic!("missing Hamlib source metadata {name}"))
}
