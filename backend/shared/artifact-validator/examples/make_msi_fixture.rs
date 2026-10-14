//! Creates a structural test MSI. It is not an installable application.
use msi::{Column, Insert, Package, PackageType, Value};
use std::{
    fs::OpenOptions,
    io::{Cursor, Read, Write},
    path::Path,
};

fn main() -> anyhow::Result<()> {
    let args: Vec<_> = std::env::args_os().collect();
    anyhow::ensure!(
        args.len() == 3,
        "make_msi_fixture <PE payload> <output MSI>"
    );
    let payload = std::fs::read(&args[1])?;
    let mut cab = cab::CabinetBuilder::new();
    cab.add_folder(cab::CompressionType::MsZip)
        .add_file("HolyCluster.exe");
    let mut writer = cab.build(Cursor::new(Vec::new()))?;
    while let Some(mut file) = writer.next_file()? {
        file.write_all(&payload)?;
    }
    let mut cabinet = writer.finish()?;
    cabinet.set_position(0);
    let mut cabinet_bytes = Vec::new();
    cabinet.read_to_end(&mut cabinet_bytes)?;
    let mut msi = Package::create(
        PackageType::Installer,
        OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(Path::new(&args[2]))?,
    )?;
    msi.create_table(
        "Property",
        vec![
            Column::build("Property").primary_key().string(72),
            Column::build("Value").string(0),
        ],
    )?;
    for (name, value) in [
        ("ProductName", "Holy Cluster"),
        ("Manufacturer", "HolyCluster dev team"),
        ("UpgradeCode", "{DD2C1F58-D922-4BEF-90BD-C01652EFD082}"),
        ("ProductCode", "{C075644F-87FD-5F49-A72A-5E37DFA08E0F}"),
        ("ProductVersion", "1.2.12340"),
        ("CATSERVER_RELEASE_VERSION", "catserver-v1.2.3"),
    ] {
        msi.insert_rows(Insert::into("Property").row(vec![Value::from(name), Value::from(value)]))?;
    }
    msi.create_table(
        "File",
        vec![
            Column::build("File").primary_key().string(72),
            Column::build("FileName").string(255),
            Column::build("FileSize").int32(),
            Column::build("Version").string(72),
            Column::build("Sequence").int32(),
        ],
    )?;
    msi.insert_rows(Insert::into("File").row(vec![
        Value::from("HolyCluster.exe"),
        Value::from("HolyCluster.exe"),
        Value::Int(payload.len().try_into()?),
        Value::from("1.2.3.0"),
        Value::Int(1),
    ]))?;
    msi.create_table(
        "Media",
        vec![
            Column::build("DiskId").primary_key().int16(),
            Column::build("LastSequence").int32(),
            Column::build("Cabinet").string(255),
        ],
    )?;
    msi.insert_rows(Insert::into("Media").row(vec![
        Value::Int(1),
        Value::Int(1),
        Value::from("#media1.cab"),
    ]))?;
    msi.write_stream("media1.cab")?.write_all(&cabinet_bytes)?;
    msi.flush()?;
    Ok(())
}
