#!/usr/bin/env python3
"""Normalize MSI database timestamps for reproducible builds"""
import sys
import msilib
from datetime import datetime


def normalize_msi_timestamp(msi_path, timestamp):
    # Open MSI database
    db = msilib.OpenDatabase(msi_path, msilib.MSIDBOPEN_DIRECT)

    # Update Summary Information Stream with deterministic timestamp
    summary_info = db.GetSummaryInformation(8)
    dt = datetime.utcfromtimestamp(int(timestamp))
    summary_info.SetProperty(msilib.PID_CREATE_DTM, dt)
    summary_info.SetProperty(msilib.PID_LASTSAVE_DTM, dt)
    summary_info.Persist()

    db.Commit()
    print(f"Normalized MSI timestamps to {dt} UTC in {msi_path}")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <msi_path> <unix_timestamp>")
        sys.exit(1)
    normalize_msi_timestamp(sys.argv[1], sys.argv[2])
