import requests


K_INDEX_ENDPOINT = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"
A_INDEX_ENDPOINT = "https://services.swpc.noaa.gov/text/daily-geomagnetic-indices.txt"
SFI_ENDPOINT = "https://services.swpc.noaa.gov/json/f107_cm_flux.json"


def collect_propagation_data():
    request = requests.get(K_INDEX_ENDPOINT)
    _, k_index, _, _ = request.json()[-1]
    k_index = float(k_index)

    request = requests.get(A_INDEX_ENDPOINT)
    last_line = request.text.strip().split("\n")[-1]
    _, _, _, planetary_index = last_line.split("    ")
    a_index, _ = planetary_index.strip().split("   ")
    a_index = int(a_index)

    request = requests.get(SFI_ENDPOINT)
    sfi = int(request.json()[0]["flux"])
    return {"k_index": k_index, "a_index": a_index, "sfi": sfi}


if __name__ == "__main__":
    print(collect_propagation_data())
