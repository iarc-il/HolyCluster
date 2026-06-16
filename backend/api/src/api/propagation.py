import re
from datetime import UTC, datetime

import aiohttp

A_INDEX_DATA_LINE_REGEX = re.compile(r"^\d{4}\s+\d{2}\s+\d{2}\s+")

K_INDEX_ENDPOINT = "/products/noaa-planetary-k-index.json"
A_INDEX_ENDPOINT = "/text/daily-geomagnetic-indices.txt"
SFI_ENDPOINT = "/json/f107_cm_flux.json"
NOAA_TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%S"
A_INDEX_DATE_FORMAT = "%Y %m %d"


def parse_k_index_history(json_data):
    samples = []
    for row in json_data:
        value = float(row["Kp"])
        if value < 0:
            continue
        samples.append(
            {
                "value": value,
                "timestamp": int(
                    datetime.strptime(row["time_tag"], NOAA_TIMESTAMP_FORMAT).replace(tzinfo=UTC).timestamp()
                ),
            }
        )
    return sorted(samples, key=lambda sample: sample["timestamp"])


def parse_a_index_history(text_data):
    samples = []
    for line in text_data.splitlines():
        line = line.strip()
        if not A_INDEX_DATA_LINE_REGEX.match(line):
            continue

        parts = re.split(r"\s{3,}", line)
        if len(parts) < 4:
            continue

        value = int(parts[3].split()[0])
        if value < 0:
            continue

        samples.append(
            {
                "value": value,
                "timestamp": int(datetime.strptime(parts[0], A_INDEX_DATE_FORMAT).replace(tzinfo=UTC).timestamp()),
            }
        )

    return sorted(samples, key=lambda sample: sample["timestamp"])


def parse_sfi_history(json_data):
    samples = []
    for row in json_data:
        value = int(row["flux"])
        if value < 0:
            continue
        samples.append(
            {
                "value": value,
                "timestamp": int(
                    datetime.strptime(row["time_tag"], NOAA_TIMESTAMP_FORMAT).replace(tzinfo=UTC).timestamp()
                ),
            }
        )
    return sorted(samples, key=lambda sample: sample["timestamp"])


def latest_propagation_from_history(history):
    latest = {}
    for metric, samples in history.items():
        if samples:
            latest[metric] = samples[-1]
        else:
            latest[metric] = {"error": "no data"}
    return latest


async def collect_propagation_history():
    async with aiohttp.ClientSession("https://services.swpc.noaa.gov") as session:
        async with session.get(K_INDEX_ENDPOINT) as response:
            k_index_history = parse_k_index_history(await response.json())

        async with session.get(A_INDEX_ENDPOINT) as response:
            a_index_history = parse_a_index_history(await response.text())

        async with session.get(SFI_ENDPOINT) as response:
            sfi_history = parse_sfi_history(await response.json())

    return {
        "k_index": k_index_history,
        "a_index": a_index_history,
        "sfi": sfi_history,
    }


async def collect_propagation_data():
    return latest_propagation_from_history(await collect_propagation_history())


async def main():
    print(await collect_propagation_data())


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
