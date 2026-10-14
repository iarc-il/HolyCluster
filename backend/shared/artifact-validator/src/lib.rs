//! Read-only package inspection shared by publication, serving, and updating.
//! This proves package structure and declared identity, not publisher authenticity.
use anyhow::{Context, Result, bail, ensure};
use backhand::{FilesystemReader, InnerNode};
use object::{Object, ObjectKind};
use std::{
    collections::HashMap,
    fs::File,
    io::{BufReader, Cursor, Read, Seek, SeekFrom},
    path::Path,
};

pub const MAX_PACKAGE_SIZE: u64 = 512 * 1024 * 1024;
const MAX_PAYLOAD_SIZE: u64 = 128 * 1024 * 1024;
const UPGRADE_CODE: &str = "DD2C1F58-D922-4BEF-90BD-C01652EFD082";

pub fn validate_package(path: &Path, platform: &str, version: &str) -> Result<()> {
    validate_open_package(
        File::open(path).context("cannot open package")?,
        platform,
        version,
    )
}

/// Inspect an open snapshot without reopening a mutable pathname.
pub fn validate_open_package(mut file: File, platform: &str, version: &str) -> Result<()> {
    file.rewind()?;
    let size = file.metadata()?.len();
    ensure!(
        size > 0 && size <= MAX_PACKAGE_SIZE,
        "package size is outside allowed bounds"
    );
    let version = version.strip_prefix("catserver-v").unwrap_or(version);
    let mut parts = version.split('-');
    let base = semver::Version::parse(parts.next().unwrap())?;
    ensure!(
        base.pre.is_empty() && base.build.is_empty(),
        "invalid release version"
    );
    let commits = parts
        .next()
        .map(str::parse::<u64>)
        .transpose()?
        .unwrap_or(0);
    if let Some(hash) = parts.next() {
        ensure!(
            hash.starts_with('g')
                && hash.len() > 1
                && hash[1..].bytes().all(|b| b.is_ascii_hexdigit()),
            "invalid release hash"
        );
    } else {
        ensure!(commits == 0, "missing release hash");
    }
    ensure!(parts.next().is_none(), "invalid release version");
    match platform {
        "windows" => validate_msi(file, version, &base, commits),
        "linux" => validate_appimage(file, version),
        _ => bail!("unsupported package platform"),
    }
}

fn bounded_read(reader: impl Read, maximum: u64) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.take(maximum + 1).read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() as u64 <= maximum,
        "package member exceeds allowed size"
    );
    Ok(bytes)
}

fn executable(bytes: &[u8], windows: bool) -> Result<()> {
    let kind = object::FileKind::parse(bytes)?;
    ensure!(
        if windows {
            kind == object::FileKind::Pe64
        } else {
            kind == object::FileKind::Elf64
        },
        "payload has the wrong executable format"
    );
    let object = object::File::parse(bytes)?;
    ensure!(
        object.architecture() == object::Architecture::X86_64,
        "payload must target x86_64"
    );
    ensure!(
        matches!(object.kind(), ObjectKind::Executable | ObjectKind::Dynamic),
        "payload is not executable"
    );
    Ok(())
}

fn validate_msi(file: File, version: &str, base: &semver::Version, commits: u64) -> Result<()> {
    let mut package = msi::Package::open(file).context("not a valid MSI database")?;
    ensure!(
        package.package_type() == msi::PackageType::Installer,
        "package is not an MSI installer"
    );
    let properties: HashMap<String, String> = package
        .select_rows(msi::Select::table("Property"))?
        .map(|row| {
            Ok((
                row["Property"]
                    .as_str()
                    .context("invalid MSI property")?
                    .to_owned(),
                row["Value"]
                    .as_str()
                    .context("invalid MSI property value")?
                    .to_owned(),
            ))
        })
        .collect::<Result<_>>()?;
    ensure!(
        properties.get("ProductName").map(String::as_str) == Some("Holy Cluster"),
        "MSI product identity does not match HolyCluster"
    );
    ensure!(
        properties.get("Manufacturer").map(String::as_str) == Some("HolyCluster dev team"),
        "MSI manufacturer does not match HolyCluster"
    );
    let product_code = properties
        .get("ProductCode")
        .context("missing MSI ProductCode")?;
    uuid::Uuid::parse_str(product_code).context("invalid MSI ProductCode")?;
    let upgrade = properties
        .get("UpgradeCode")
        .context("missing MSI UpgradeCode")?
        .trim_matches(['{', '}']);
    ensure!(
        upgrade.eq_ignore_ascii_case(UPGRADE_CODE),
        "MSI UpgradeCode does not match HolyCluster"
    );
    if let Some(release) = properties.get("CATSERVER_RELEASE_VERSION") {
        ensure!(
            release == &format!("catserver-v{version}"),
            "MSI release version does not match manifest"
        );
    }
    // Existing installers use a commit-count ProductVersion. The File table
    // carries the executable's release version, including the development count.
    let expected_file_version = format!("{}.{}.{}.{commits}", base.major, base.minor, base.patch);
    let files: Vec<_> = package
        .select_rows(msi::Select::table("File"))?
        .map(|row| {
            Ok((
                row["File"]
                    .as_str()
                    .context("invalid MSI file identifier")?
                    .to_owned(),
                row["FileName"]
                    .as_str()
                    .context("invalid MSI filename")?
                    .to_owned(),
                row["Version"].as_str().unwrap_or("").to_owned(),
                row["FileSize"].as_int().context("invalid MSI file size")?,
                row["Sequence"]
                    .as_int()
                    .context("invalid MSI file sequence")?,
            ))
        })
        .collect::<Result<_>>()?;
    let matching: Vec<_> = files
        .iter()
        .filter(|(_, name, _, _, _)| name.rsplit('|').next() == Some("HolyCluster.exe"))
        .collect();
    ensure!(
        matching.len() == 1,
        "MSI must contain exactly one HolyCluster.exe"
    );
    let (id, _, file_version, file_size, sequence) = matching[0];
    ensure!(
        file_version == &expected_file_version,
        "MSI executable version does not match manifest"
    );
    ensure!(
        *file_size > 0 && *file_size as u64 <= MAX_PAYLOAD_SIZE,
        "MSI executable size is outside allowed bounds"
    );
    let mut cabinets: Vec<_> = package
        .select_rows(msi::Select::table("Media"))?
        .map(|row| {
            Ok((
                row["LastSequence"]
                    .as_int()
                    .context("invalid MSI media sequence")?,
                row["Cabinet"]
                    .as_str()
                    .context("MSI cabinet must be embedded")?
                    .to_owned(),
            ))
        })
        .collect::<Result<_>>()?;
    cabinets.sort_by_key(|(last, _)| *last);
    let cabinet = &cabinets
        .iter()
        .find(|(last, _)| last >= sequence)
        .context("MSI executable has no cabinet")?
        .1;
    let stream = cabinet
        .strip_prefix('#')
        .context("MSI cabinet must be embedded")?;
    let data = bounded_read(package.read_stream(stream)?, MAX_PACKAGE_SIZE)?;
    let mut cabinet = cab::Cabinet::new(Cursor::new(data)).context("invalid MSI cabinet")?;
    let payload = bounded_read(cabinet.read_file(id)?, MAX_PAYLOAD_SIZE)?;
    ensure!(
        payload.len() == *file_size as usize,
        "MSI executable size does not match File table"
    );
    executable(&payload, true)
}

fn validate_appimage(mut file: File, version: &str) -> Result<()> {
    let mut header = [0u8; 64];
    file.read_exact(&mut header)
        .context("truncated AppImage header")?;
    ensure!(
        &header[..7] == b"\x7fELF\x02\x01\x01" && &header[8..11] == b"AI\x02",
        "not a type-2 ELF64 AppImage"
    );
    ensure!(
        u16::from_le_bytes(header[18..20].try_into().unwrap()) == 62,
        "AppImage must target x86_64"
    );
    let section_offset = u64::from_le_bytes(header[40..48].try_into().unwrap());
    let section_size = u16::from_le_bytes(header[58..60].try_into().unwrap());
    let section_count = u16::from_le_bytes(header[60..62].try_into().unwrap());
    ensure!(
        section_offset >= 64 && section_size == 64 && section_count > 0,
        "invalid AppImage ELF section table"
    );
    // Type-2 runtime determines the filesystem offset from the ELF section table.
    // Scanning for 'hsqs' is unsafe: the runtime itself can contain that string.
    let offset = section_offset
        .checked_add(u64::from(section_size) * u64::from(section_count))
        .context("AppImage offset overflow")?;
    ensure!(
        offset < file.metadata()?.len(),
        "AppImage filesystem is missing"
    );
    file.seek(SeekFrom::Start(0))?;
    let runtime = bounded_read((&mut file).take(offset), 16 * 1024 * 1024)?;
    executable(&runtime, false).context("invalid AppImage runtime")?;
    let fs = FilesystemReader::from_reader_with_offset(BufReader::new(file), offset)
        .context("invalid AppImage SquashFS filesystem")?;
    let member = |name: &str, maximum: u64| -> Result<Vec<u8>> {
        let mut path = Path::new(name).to_path_buf();
        for _ in 0..8 {
            let node = fs
                .files()
                .find(|node| node.fullpath == path)
                .with_context(|| format!("AppImage is missing {name}"))?;
            match &node.inner {
                InnerNode::File(data) => {
                    return bounded_read(fs.file(data).reader_checked()?, maximum);
                }
                InnerNode::Symlink(link) => {
                    ensure!(
                        link.link.is_relative()
                            && link.link.components().all(|part| matches!(
                                part,
                                std::path::Component::Normal(_) | std::path::Component::CurDir
                            )),
                        "AppImage member links outside its archive"
                    );
                    path = path
                        .parent()
                        .context("invalid archive symlink")?
                        .join(&link.link)
                        .components()
                        .collect();
                }
                _ => bail!("AppImage member must resolve to a regular file: {name}"),
            }
        }
        bail!("too many AppImage symlink hops")
    };
    let desktop = member("/HolyCluster.desktop", 64 * 1024)?;
    let desktop = std::str::from_utf8(&desktop)?;
    ensure!(
        desktop.lines().any(|line| line == "Name=HolyCluster")
            && desktop.lines().any(|line| line == "Exec=HolyCluster"),
        "AppImage desktop identity does not match HolyCluster"
    );
    let app_run = member("/AppRun", 64 * 1024)?;
    ensure!(
        std::str::from_utf8(&app_run)?.contains("exec \"$APPDIR/usr/bin/HolyCluster\" \"$@\""),
        "AppImage entry point does not match HolyCluster"
    );
    let payload = member("/usr/bin/HolyCluster", MAX_PAYLOAD_SIZE)?;
    executable(&payload, false)?;
    if fs
        .files()
        .any(|node| node.fullpath == Path::new("/holy-release.json"))
    {
        let metadata: serde_json::Value =
            serde_json::from_slice(&member("/holy-release.json", 4096)?)?;
        ensure!(
            metadata["version"] == format!("catserver-v{version}")
                && metadata["platform"] == "linux"
                && metadata["architecture"] == "x86_64",
            "AppImage release metadata does not match manifest"
        );
    } else {
        // Legacy AppImages lack a separate release descriptor. Require their
        // compiled release tag; new builds add the exact JSON descriptor.
        let tag = format!("catserver-v{version}");
        ensure!(
            payload
                .windows(tag.len())
                .enumerate()
                .any(|(index, bytes)| bytes == tag.as_bytes()
                    && !payload
                        .get(index + tag.len())
                        .is_some_and(|byte| byte.is_ascii_digit() || *byte == b'-')),
            "AppImage compiled release tag does not match manifest"
        );
    }
    Ok(())
}
