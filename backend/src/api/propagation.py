import logging
from datetime import datetime
import re
import aiohttp


A_INDEX_REGEX = re.compile("(.*) {3,}(.*) {3,}(.*) {3,}(.*) {3,}")

K_INDEX_ENDPOINT = "/products/noaa-planetary-k-index.json"
A_INDEX_ENDPOINT = "/text/daily-geomagnetic-indices.txt"
SFI_ENDPOINT = "/json/f107_cm_flux.json"


logger = logging.getLogger(__name__)


async def collect_propagation_data():
    async with aiohttp.ClientSession("https://services.swpc.noaa.gov") as session:
        async with session.get(K_INDEX_ENDPOINT) as response:
            json_data = await response.json()
            k_time, k_index, _, _ = (json_data)[-1]
            k_time = int(datetime.strptime(k_time, "%Y-%m-%d %H:%M:%S.%f").timestamp())
            k_index = float(k_index)
            k_values = {"value": k_index, "timestamp": k_time}

        async with session.get(A_INDEX_ENDPOINT) as response:
            text_data = await response.text()
            last_line = (text_data).strip().split("\n")[-1]
            match = A_INDEX_REGEX.match(last_line)
            if match is not None:
                a_time, _, _, a_index = match.groups()
                a_time = int(datetime.strptime(a_time, "%Y %m %d ").timestamp())
                a_index = int(a_index)
                a_values = {"value": a_index, "timestamp": a_time}
            else:
                a_values = {"error": f"no match for line: {last_line}"}

        async with session.get(SFI_ENDPOINT) as response:
            json_data = await response.json()
            sfi = int(json_data[0]["flux"])
            sfi_time = json_data[0]["time_tag"]
            sfi_time = int(datetime.strptime(sfi_time, "%Y-%m-%dT%H:%M:%S").timestamp())
            sfi_values = {"value": sfi, "timestamp": sfi_time}

        return {
            "k_index": k_values,
            "a_index": a_values,
            "sfi": sfi_values,
        }



async def main():
    print(await collect_propagation_data())


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
