#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourcePackage {
    pub name: &'static str,
    pub version: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub archive_root: &'static str,
    pub license: &'static str,
}

pub const HAMLIB: SourcePackage = SourcePackage {
    name: "hamlib",
    version: "4.7.2",
    url: "https://github.com/Hamlib/Hamlib/releases/download/4.7.2/hamlib-4.7.2.tar.gz",
    sha256: "ae1fcf2dbc80ea0786ea8f047b09399c3f7737d1930442f61a031708ed33e88f",
    archive_root: "hamlib-4.7.2",
    license: "LGPL-2.1-or-later",
};

pub const LIBUSB: SourcePackage = SourcePackage {
    name: "libusb",
    version: "1.0.30",
    url: "https://github.com/libusb/libusb/releases/download/v1.0.30/libusb-1.0.30.tar.bz2",
    sha256: "fea36f34f9156400209595e300840767ab1a385ede1dc7ee893015aea9c6dbaf",
    archive_root: "libusb-1.0.30",
    license: "LGPL-2.1-or-later",
};
