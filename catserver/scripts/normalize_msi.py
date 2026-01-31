#!/usr/bin/env python3
"""Normalize MSI database timestamps for reproducible builds using msitools"""

import sys
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def normalize_msi_timestamp(msi_path, timestamp):
    """
    Normalize MSI timestamps using msitools for cross-platform support.

    This exports the _SummaryInformation table, modifies timestamp properties,
    and re-imports it back into the MSI.

    Timestamp properties in _SummaryInformation:
    - Property ID 11: Last Printed (VT_FILETIME)
    - Property ID 12: Create Time/Date (VT_FILETIME)
    - Property ID 13: Last Save Time/Date (VT_FILETIME)
    """
    msi_path = Path(msi_path).resolve()
    dt = datetime.fromtimestamp(int(timestamp), tz=timezone.utc)
    timestamp_str = dt.strftime("%Y/%m/%d %H:%M:%S")

    print(f"Normalizing MSI timestamps to {timestamp_str} UTC in {msi_path}")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        idt_file = tmpdir / "_SummaryInformation.idt"

        print("Exporting _SummaryInformation table")
        result = subprocess.run(
            ["msiinfo", "export", str(msi_path), "_SummaryInformation"],
            cwd=tmpdir,
            check=True,
            capture_output=True,
            text=True
        )

        # Write the exported table to the .idt file
        with open(idt_file, "w", encoding="utf-8") as f:
            f.write(result.stdout)

        print(f"Modifying timestamps to {timestamp_str}")
        with open(idt_file, "r", encoding="utf-8") as f:
            lines = f.readlines()

        modified_lines = []
        for line in lines:
            if line.startswith("PropertyId\t") or line.startswith("i2\t") or line.startswith("_SummaryInformation\t"):
                modified_lines.append(line)
                continue

            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 2:
                prop_id = parts[0]
                if prop_id in ("11", "12", "13"):
                    parts[1] = timestamp_str
                modified_lines.append("\t".join(parts) + "\n")
            else:
                modified_lines.append(line)

        with open(idt_file, "w", encoding="utf-8") as f:
            f.writelines(modified_lines)

        print("Importing modified _SummaryInformation table...")
        subprocess.run(["msibuild", str(msi_path), "-i", str(idt_file)], check=True, capture_output=True)

    print(f"Successfully normalized MSI timestamps in {msi_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <msi_path> <unix_timestamp>")
        sys.exit(1)
    normalize_msi_timestamp(sys.argv[1], sys.argv[2])
