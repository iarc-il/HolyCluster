class Position:
    def __init__(self, lat: float, lon: float):
        self.lat = lat
        self.lon = lon

    def __str__(self):
        return f"{self.lat},{self.lon}"


def locator_to_coordinates(locator: str) -> tuple[float, float]:
    # Many thanks to Dmitry (4X5DM) for the algorithm

    # Constants
    ASCII_0 = 48
    ASCII_A = 65

    # Validate input
    assert isinstance(locator, str)
    assert 4 <= len(locator) <= 8
    assert len(locator) % 2 == 0

    locator = locator.upper()

    # Separate fields, squares and subsquares
    # Fields
    lon_field = ord(locator[0]) - ASCII_A
    lat_field = ord(locator[1]) - ASCII_A

    # Squares
    lon_sq = ord(locator[2]) - ASCII_0
    lat_sq = ord(locator[3]) - ASCII_0

    # Subsquares
    if len(locator) >= 6:
        lon_sub_sq = ord(locator[4]) - ASCII_A
        lat_sub_sq = ord(locator[5]) - ASCII_A
    else:
        lon_sub_sq = 0
        lat_sub_sq = 0

    # Extended squares
    if len(locator) == 8:
        lon_ext_sq = ord(locator[6]) - ASCII_0
        lat_ext_sq = ord(locator[7]) - ASCII_0
    else:
        lon_ext_sq = 0
        lat_ext_sq = 0

    # Calculate latitude and longitude
    lon = -180.0
    lat = -90.0

    lon += 20.0 * lon_field
    lat += 10.0 * lat_field

    lon += 2.0 * lon_sq
    lat += 1.0 * lat_sq

    lon += 5.0 / 60 * lon_sub_sq
    lat += 2.5 / 60 * lat_sub_sq

    lon += 0.5 / 60 * lon_ext_sq
    lat += 0.25 / 60 * lat_ext_sq

    return float(int(lat * 10000)) / 10000, float(int(lon * 10000)) / 10000
