#!/usr/bin/env python3
"""Normalize PE executable timestamps for reproducible builds"""
import sys
import struct


def normalize_pe_timestamp(exe_path):
    with open(exe_path, 'r+b') as f:
        # Read DOS header to find PE offset
        f.seek(0x3C)
        pe_offset = struct.unpack('<I', f.read(4))[0]

        # Zero out TimeDateStamp field (PE header + 8 bytes)
        f.seek(pe_offset + 8)
        f.write(struct.pack('<I', 0))

        print(f"Normalized PE timestamp in {exe_path}")


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <exe_path>")
        sys.exit(1)
    normalize_pe_timestamp(sys.argv[1])
