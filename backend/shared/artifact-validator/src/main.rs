use std::path::Path;

fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    let result = (|| -> anyhow::Result<()> {
        anyhow::ensure!(
            args.len() == 4,
            "usage: holy-artifact-validator <windows|linux> <release-version> <file>"
        );
        holy_artifact_validator::validate_package(
            Path::new(&args[3]),
            args[1]
                .to_str()
                .ok_or_else(|| anyhow::anyhow!("invalid platform"))?,
            args[2]
                .to_str()
                .ok_or_else(|| anyhow::anyhow!("invalid version"))?,
        )
    })();
    if let Err(error) = result {
        eprintln!("Package validation failed: {error:#}");
        std::process::exit(1);
    }
}
