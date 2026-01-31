#!/usr/bin/env python3
"""Normalize MSI database timestamps for reproducible builds using msitools"""
import sys
import os
import subprocess
import tempfile
from datetime import datetime
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
    dt = datetime.utcfromtimestamp(int(timestamp))
    # Format: YYYY/MM/DD hh:mm:ss
    timestamp_str = dt.strftime("%Y/%m/%d %H:%M:%S")

    print(f"Normalizing MSI timestamps to {timestamp_str} UTC in {msi_path}")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        idt_file = tmpdir / "_SummaryInformation.idt"

        # Export _SummaryInformation table to .idt file
        print("Exporting _SummaryInformation table...")
        subprocess.run(
            ["msiinfo", "export", str(msi_path), "_SummaryInformation"],
            cwd=tmpdir,
            check=True,
            capture_output=True
        )

        # Read and modify the .idt file
        print(f"Modifying timestamps to {timestamp_str}...")
        with open(idt_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        modified_lines = []
        for line in lines:
            # Skip header lines and table definition
            if line.startswith('PropertyId\t') or line.startswith('i2\t') or line.startswith('_SummaryInformation\t'):
                modified_lines.append(line)
                continue

            # Parse property lines
            parts = line.rstrip('\n').split('\t')
            if len(parts) >= 2:
                prop_id = parts[0]
                # Update timestamp properties (11=Last Printed, 12=Create Time, 13=Last Save Time)
                if prop_id in ('11', '12', '13'):
                    parts[1] = timestamp_str
                modified_lines.append('\t'.join(parts) + '\n')
            else:
                modified_lines.append(line)

        # Write modified .idt file
        with open(idt_file, 'w', encoding='utf-8') as f:
            f.writelines(modified_lines)

        # Re-import the modified table back into the MSI
        print("Importing modified _SummaryInformation table...")
        subprocess.run(
            ["msibuild", str(msi_path), "-i", str(idt_file)],
            check=True,
            capture_output=True
        )

    print(f"Successfully normalized MSI timestamps in {msi_path}")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <msi_path> <unix_timestamp>")
        sys.exit(1)
    normalize_msi_timestamp(sys.argv[1], sys.argv[2])
