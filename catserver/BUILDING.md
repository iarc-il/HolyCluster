# Build CatServer

Run these commands from `catserver/`. Cargo builds Rust code and the pinned Hamlib sources together.
The Windows build also builds a pinned static libusb archive.
An archive is a file that contains compiled native objects.

## Tools

Use the Rust toolchain and native tools in `Dockerfile`, or the CI container pinned in `.github/workflows/catserver.yml`.
For Linux, install a C/C++ compiler, Make, pkg-config, and development packages for GTK 3, libusb, libudev, and libxdo.
For Windows builds on Linux, install the x86_64 MinGW GCC/G++ POSIX toolchain and binutils.
Add the Rust target before the first Windows build:

```sh
rustup target add x86_64-pc-windows-gnu
```

The build downloads pinned source archives when the cache is empty.
It checks their SHA256 hashes before extraction.
`CARGO_TARGET_DIR` selects the Cargo artifact and source cache directory.

## Cargo entry

Build a Windows release:

```sh
cargo build --workspace --target x86_64-pc-windows-gnu --release --locked
```

Build a Linux release:

```sh
cargo build --workspace --target x86_64-unknown-linux-gnu --release --locked
```

`build_windows.sh` is an optional convenience wrapper for the Windows command.
It forwards extra arguments and does not set compiler flags.
For a debug build, omit `--release` from the Cargo command.

Release builds use Rust `opt-level = "z"`, stripping, and LTO (optimization across Rust compilation units).
The Windows target configuration retains static runtime flags and disables the linker timestamp.
Managed Hamlib release builds add standard native size flags while retaining caller `CFLAGS` and `CXXFLAGS`.
Debug builds do not add those size flags.
There is no 10 MB release size requirement.
Build correctness and platform compatibility take priority over that former size goal.

## Source and compiler configuration

`HAMLIB_SOURCE_DIR` selects an existing Hamlib tree with a generated `configure` script.
Cargo watches that tree but does not apply managed-source size flags to it.
The build uses Make's existing dependency rules for that tree.
If you change compiler flags for existing objects, clean the native tree before rebuilding.

`HAMLIB_SOURCE_ARCHIVE` selects a local archive instead of the downloaded Hamlib archive.
The pinned hash still applies.
`HAMLIB_SOURCE_NETWORK=0` disables source downloads and requires cached or local source archives.
Cargo watches source archives and installed static archives, so replacements at the same path trigger rebuilds.

Caller compiler and linker flags remain inputs to the native build.
For Windows, the build selects the MinGW toolchain and the managed libusb search paths.
It appends those search paths to caller `CPPFLAGS` and `LDFLAGS`.
Rust flags follow Cargo's normal configuration precedence.
If you set `RUSTFLAGS` or `CARGO_ENCODED_RUSTFLAGS`, include the required Windows static flags yourself.
Those variables override the target flags in `.cargo/config.toml`.

## Reproducible Windows releases

CI sets `SOURCE_DATE_EPOCH` from the commit time and `CATSERVER_VERSION` from the release tags.
It also sets `TZ=UTC`, `LC_ALL=C.UTF-8`, and `ZERO_AR_DATE=1`.
Source path mapping replaces the checkout path in compiled output with `/src`.
CI appends native `-ffile-prefix-map` flags and adds Rust `--remap-path-prefix` through Cargo's CLI configuration.
Cargo merges that Rust flag array with the Windows static flags in `.cargo/config.toml`.

For the same path mapping locally, run:

```sh
export CFLAGS="${CFLAGS:+$CFLAGS }-ffile-prefix-map=$(pwd -P)=/src"
export CXXFLAGS="${CXXFLAGS:+$CXXFLAGS }-ffile-prefix-map=$(pwd -P)=/src"
RUST_CONFIG=$(python3 -c 'import json, os; print("target.x86_64-pc-windows-gnu.rustflags = " + json.dumps(["--remap-path-prefix=" + os.getcwd() + "=/src"]))')
cargo build --workspace --target x86_64-pc-windows-gnu --release --locked --config "$RUST_CONFIG"
```

Caller `RUSTFLAGS` and `CARGO_ENCODED_RUSTFLAGS` keep their precedence and can disable this Rust path mapping.
CI uses faster Rust release configuration for development branches and retains full LTO for production tags.
The default Cargo release profile retains LTO.
No RELR relocation packing is enabled, and these defaults do not select a newer minimum glibc version.
Linux compatibility still depends on the libraries and toolchain used for the build.

## Tests and packaging

Run the normal workspace tests with `cargo test --workspace`.
The standalone build-input test uses a fake native runtime and does not build Hamlib:

```sh
python3 tests/test_native_build_inputs.py
python3 tests/test_build_entry.py
```

After Cargo finishes, use `build_msi.sh` or `build_appimage.sh` for packaging.
The publisher and package scripts remain separate from the Cargo build entry.
CI rejects Windows imports of non-system DLLs before packaging.
