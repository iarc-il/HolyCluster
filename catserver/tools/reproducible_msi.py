#!/usr/bin/env python3
import argparse
import hashlib
import os
import struct
import tempfile
import uuid
from pathlib import Path

FREE_SECTOR = 0xFFFFFFFF
END_OF_CHAIN = 0xFFFFFFFE
FAT_SECTOR = 0xFFFFFFFD
DIFAT_SECTOR = 0xFFFFFFFC
SUMMARY_INFORMATION = "\x05SummaryInformation"
PLACEHOLDER_PACKAGE_CODE = "{00000000-0000-5000-8000-000000000000}"
PRODUCT_NAMESPACE = uuid.UUID("8b27b59b-03d9-527d-8d98-c5d46f894643")
PACKAGE_NAMESPACE = uuid.uuid5(PRODUCT_NAMESPACE, "MSI package")


class CompoundFile:
    def __init__(self, path):
        self.path = Path(path)
        self.data = bytearray(self.path.read_bytes())
        if self.data[:8] != bytes.fromhex("d0cf11e0a1b11ae1"):
            raise ValueError("not an OLE compound file")
        self.major_version = self.u16(26)
        self.sector_size = 1 << self.u16(30)
        self.mini_sector_size = 1 << self.u16(32)
        self.first_directory_sector = self.u32(48)
        self.mini_stream_cutoff = self.u32(56)
        self.first_mini_fat_sector = self.u32(60)
        self.mini_fat_sector_count = self.u32(64)
        self.first_difat_sector = self.u32(68)
        self.difat_sector_count = self.u32(72)
        self.fat = self._load_fat()
        self.directory = self._read_chain(self.first_directory_sector, self.fat)
        self.entries = self._parse_directory()
        self.root = next(entry for entry in self.entries if entry["type"] == 5)
        mini_fat_data = self._read_chain(self.first_mini_fat_sector, self.fat)
        mini_fat_data = mini_fat_data[: self.mini_fat_sector_count * self.sector_size]
        self.mini_fat = list(struct.unpack(f"<{len(mini_fat_data) // 4}I", mini_fat_data))
        self.root_chain = self._chain(self.root["start"], self.fat)

    def u16(self, offset):
        return struct.unpack_from("<H", self.data, offset)[0]

    def u32(self, offset):
        return struct.unpack_from("<I", self.data, offset)[0]

    def _sector_offset(self, sector):
        offset = (sector + 1) * self.sector_size
        if sector >= END_OF_CHAIN or offset + self.sector_size > len(self.data):
            raise ValueError(f"invalid sector {sector:#x}")
        return offset

    def _sector(self, sector):
        offset = self._sector_offset(sector)
        return self.data[offset : offset + self.sector_size]

    def _load_fat(self):
        fat_sector_count = self.u32(44)
        sectors = [value for value in struct.unpack_from("<109I", self.data, 76) if value != FREE_SECTOR]
        next_difat = self.first_difat_sector
        for _ in range(self.difat_sector_count):
            values = struct.unpack(f"<{self.sector_size // 4}I", self._sector(next_difat))
            sectors.extend(value for value in values[:-1] if value != FREE_SECTOR)
            next_difat = values[-1]
        sectors = sectors[:fat_sector_count]
        if len(sectors) != fat_sector_count:
            raise ValueError("incomplete FAT sector list")
        data = b"".join(self._sector(sector) for sector in sectors)
        return list(struct.unpack(f"<{len(data) // 4}I", data))

    def _chain(self, start, table):
        if start == END_OF_CHAIN:
            return []
        chain = []
        seen = set()
        sector = start
        while sector != END_OF_CHAIN:
            if sector in seen or sector >= len(table):
                raise ValueError("invalid sector chain")
            if sector in (FREE_SECTOR, FAT_SECTOR, DIFAT_SECTOR):
                raise ValueError("reserved sector in stream chain")
            seen.add(sector)
            chain.append(sector)
            sector = table[sector]
        return chain

    def _read_chain(self, start, table):
        return b"".join(self._sector(sector) for sector in self._chain(start, table))

    def _parse_directory(self):
        entries = []
        for offset in range(0, len(self.directory), 128):
            raw = self.directory[offset : offset + 128]
            if len(raw) < 128:
                break
            name_length = struct.unpack_from("<H", raw, 64)[0]
            entry_type = raw[66]
            if not entry_type:
                continue
            if name_length < 2 or name_length > 64 or name_length % 2:
                raise ValueError("invalid directory entry name")
            name = raw[: name_length - 2].decode("utf-16le")
            size = struct.unpack_from("<Q", raw, 120)[0]
            if self.major_version == 3 and entry_type == 2:
                size &= 0xFFFFFFFF
            entries.append({
                "name": name,
                "type": entry_type,
                "start": struct.unpack_from("<I", raw, 116)[0],
                "size": size,
            })
        return entries

    def _stream_spans(self, entry):
        size = entry["size"]
        spans = []
        if size < self.mini_stream_cutoff and entry["type"] == 2:
            for mini_sector in self._chain(entry["start"], self.mini_fat):
                logical = mini_sector * self.mini_sector_size
                root_index, within = divmod(logical, self.sector_size)
                if root_index >= len(self.root_chain) or within + self.mini_sector_size > self.sector_size:
                    raise ValueError("invalid mini stream sector")
                spans.append((self._sector_offset(self.root_chain[root_index]) + within, self.mini_sector_size))
        else:
            spans.extend((self._sector_offset(sector), self.sector_size) for sector in self._chain(entry["start"], self.fat))
        if sum(length for _, length in spans) < size:
            raise ValueError("truncated stream chain")
        return spans

    def read_stream(self, name):
        entry = next((entry for entry in self.entries if entry["name"] == name), None)
        if entry is None:
            raise ValueError(f"missing stream {name!r}")
        output = bytearray()
        for offset, length in self._stream_spans(entry):
            output.extend(self.data[offset : offset + length])
        return entry, output[: entry["size"]]

    def write_stream(self, entry, stream):
        if len(stream) != entry["size"]:
            raise ValueError("stream size changed")
        position = 0
        for offset, length in self._stream_spans(entry):
            chunk = min(length, len(stream) - position)
            if chunk <= 0:
                break
            self.data[offset : offset + chunk] = stream[position : position + chunk]
            position += chunk
        if position != len(stream):
            raise ValueError("stream write was incomplete")

    def save(self):
        mode = self.path.stat().st_mode
        fd, temporary = tempfile.mkstemp(prefix=f".{self.path.name}.", dir=self.path.parent)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(self.data)
                output.flush()
                os.fsync(output.fileno())
            os.chmod(temporary, mode)
            os.replace(temporary, self.path)
        except BaseException:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
            raise


def property_offsets(stream):
    if len(stream) < 48 or struct.unpack_from("<H", stream, 0)[0] != 0xFFFE:
        raise ValueError("invalid SummaryInformation property set")
    section_count = struct.unpack_from("<I", stream, 24)[0]
    properties = {}
    for index in range(section_count):
        section_offset = struct.unpack_from("<I", stream, 28 + index * 20 + 16)[0]
        property_count = struct.unpack_from("<I", stream, section_offset + 4)[0]
        for property_index in range(property_count):
            entry_offset = section_offset + 8 + property_index * 8
            property_id, value_offset = struct.unpack_from("<II", stream, entry_offset)
            properties[property_id] = section_offset + value_offset
    return properties


def patch_summary(stream, epoch, package_code):
    properties = property_offsets(stream)
    revision = properties.get(9)
    created = properties.get(12)
    modified = properties.get(13)
    if None in (revision, created, modified):
        raise ValueError("SummaryInformation lacks required properties")
    if struct.unpack_from("<I", stream, revision)[0] != 30:
        raise ValueError("package code is not an LPSTR")
    length = struct.unpack_from("<I", stream, revision + 4)[0]
    encoded_code = package_code.encode("ascii") + b"\0"
    if len(encoded_code) != length:
        raise ValueError("package code length changed")
    stream[revision + 8 : revision + 8 + length] = encoded_code
    filetime = (epoch + 11644473600) * 10_000_000
    if not 0 <= filetime <= 0xFFFFFFFFFFFFFFFF:
        raise ValueError("SOURCE_DATE_EPOCH is outside FILETIME range")
    for offset in (created, modified):
        if struct.unpack_from("<I", stream, offset)[0] != 64:
            raise ValueError("summary timestamp is not a FILETIME")
        struct.pack_into("<Q", stream, offset + 4, filetime)


def package_guid(digest):
    return "{" + str(uuid.uuid5(PACKAGE_NAMESPACE, digest.hex())).upper() + "}"


def normalize(path, epoch):
    compound = CompoundFile(path)
    entry, summary = compound.read_stream(SUMMARY_INFORMATION)
    patch_summary(summary, epoch, PLACEHOLDER_PACKAGE_CODE)
    compound.write_stream(entry, summary)
    code = package_guid(hashlib.sha256(compound.data).digest())
    patch_summary(summary, epoch, code)
    compound.write_stream(entry, summary)
    compound.save()
    return code


def main():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    guid_parser = subparsers.add_parser("guid")
    guid_parser.add_argument("identity")
    normalize_parser = subparsers.add_parser("normalize")
    normalize_parser.add_argument("path")
    normalize_parser.add_argument("source_date_epoch", type=int)
    arguments = parser.parse_args()
    if arguments.command == "guid":
        print("{" + str(uuid.uuid5(PRODUCT_NAMESPACE, arguments.identity)).upper() + "}")
    else:
        print(normalize(arguments.path, arguments.source_date_epoch))


if __name__ == "__main__":
    main()
