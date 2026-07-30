# Hamlib And libusb

HolyCluster can be built with Hamlib 4.7.2 and libusb 1.0.30. Hamlib and libusb are licensed under LGPL-2.1-or-later. Staged native runtime distributions include their exact license texts, source URLs, and SHA-256 hashes.

The default build downloads only this pinned Hamlib release archive:

- Source: `https://github.com/Hamlib/Hamlib/releases/download/4.7.2/hamlib-4.7.2.tar.gz`
- SHA-256: `ae1fcf2dbc80ea0786ea8f047b09399c3f7737d1930442f61a031708ed33e88f`
- Source repository: `https://github.com/Hamlib/Hamlib`

The complete HolyCluster source and build instructions are available in this repository. To build a modified Hamlib tree instead of the pinned release, its generated `configure` script must be present and the tree is built in place:

```sh
HAMLIB_SOURCE_DIR=/absolute/path/to/hamlib cargo build --manifest-path catserver/Cargo.toml
```

Use a separate working tree for this override because `configure` and `make` create build artifacts in that source tree. The normal pinned build remains checksum-verified and does not use this override.
