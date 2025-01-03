import aiohttp


K_INDEX_ENDPOINT = "/products/noaa-planetary-k-index.json"
A_INDEX_ENDPOINT = "/text/daily-geomagnetic-indices.txt"
SFI_ENDPOINT = "/json/f107_cm_flux.json"


async def collect_propagation_data():
    async with aiohttp.ClientSession("https://services.swpc.noaa.gov") as session:
        async with session.get(K_INDEX_ENDPOINT) as response:
            json_data = await response.json()
            _, k_index, _, _ = (json_data)[-1]
            k_index = float(k_index)

        async with session.get(A_INDEX_ENDPOINT) as response:
            text_data = await response.text()
            last_line = (text_data).strip().split("\n")[-1]
            _, _, _, planetary_index = last_line.split("    ")
            a_index, _ = planetary_index.strip().split("   ")
            a_index = int(a_index)

        async with session.get(SFI_ENDPOINT) as response:
            json_data = await response.json()
            sfi = int(json_data[0]["flux"])

        return {"k_index": k_index, "a_index": a_index, "sfi": sfi}


if __name__ == "__main__":
    print(collect_propagation_data())
