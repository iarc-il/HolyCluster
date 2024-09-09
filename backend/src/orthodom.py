import math
from src.location import Position

class orthodrome:

    # Function to convert degrees to radians
    @staticmethod
    def deg2rad(deg):
        return deg * (math.pi / 180)

    # Function to convert radians to degrees
    @staticmethod
    def rad2deg(rad):
        return rad * (180 / math.pi)

    # Function to calculate initial bearing
    @staticmethod
    def initial_bearing(lat1, lon1, lat2, lon2):
        delta_lon = lon2 - lon1
        y = math.sin(delta_lon) * math.cos(lat2)
        x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lon)
        return math.atan2(y, x)

    # Function to calculate angular distance between two points
    @staticmethod
    def angular_distance(lat1, lon1, lat2, lon2):
        return math.acos(math.sin(lat1) * math.sin(lat2) + math.cos(lat1) * math.cos(lat2) * math.cos(lon2 - lon1))

    # Function to calculate intermediate points
    @staticmethod
    def get_orthodrome(lat1, lon1, lat2, lon2, n):
        if lat1==lat2 and lon1==lon2:
            return None
        points = []
        lats, lons = [], []
        lat1 = orthodrome.deg2rad(lat1)
        lon1 = orthodrome.deg2rad(lon1)
        lat2 = orthodrome.deg2rad(lat2)
        lon2 = orthodrome.deg2rad(lon2)

        # Calculate initial bearing
        theta = orthodrome.initial_bearing(lat1, lon1, lat2, lon2)

        # Calculate angular distance
        delta = orthodrome.angular_distance(lat1, lon1, lat2, lon2)

        # Calculate the angular distance between each point
        delta_dist = delta / (n + 1)

        #add initial point
        lats.append(orthodrome.rad2deg(lat1))
        lons.append(orthodrome.rad2deg(lon1))
        points.append((orthodrome.rad2deg(lat1),orthodrome.rad2deg(lon1)))

        # Calculate points
        for i in range(1, n + 1):
            # Calculate the angular distance from the starting point to the intermediate point
            d_AB = delta_dist * i

            # Calculate latitude of the intermediate point
            lat_mid = math.asin(math.sin(lat1) * math.cos(d_AB) + math.cos(lat1) * math.sin(d_AB) * math.cos(theta))

            # Calculate longitude of the intermediate point
            lon_mid = lon1 + math.atan2(math.sin(theta) * math.sin(d_AB) * math.cos(lat1), math.cos(d_AB) - math.sin(lat1) * math.sin(lat_mid))

            # Convert back to degrees
            lat_mid = orthodrome.rad2deg(lat_mid)
            lon_mid = orthodrome.rad2deg(lon_mid)

            lats.append(lat_mid)
            lons.append(lon_mid)
            points.append(Position(lat_mid,lon_mid))

        lats.append(orthodrome.rad2deg(lat2))
        lons.append(orthodrome.rad2deg(lon2))
        points.append((orthodrome.rad2deg(lat2),orthodrome.rad2deg(lon2)))
        #return lats,lons
        return points

    @staticmethod
    def locator_to_coordinates(qth_locator):
        # Many thanks to Dmitry (4X5DM) for the algorithm

        # Constants
        ASCII_0 = 48
        ASCII_A = 65
        ASCII_a = 97
        # Validate input
        assert isinstance(qth_locator, str)
        assert 4 <= len(qth_locator) <= 8
        assert len(qth_locator) % 2 == 0

        qth_locator = qth_locator.upper()

        # Separate fields, squares and subsquares
        # Fields
        lon_field = ord(qth_locator[0]) - ASCII_A
        lat_field = ord(qth_locator[1]) - ASCII_A

        # Squares
        lon_sq = ord(qth_locator[2]) - ASCII_0
        lat_sq = ord(qth_locator[3]) - ASCII_0

        # Subsquares
        if len(qth_locator) >= 6:
            lon_sub_sq = ord(qth_locator[4]) - ASCII_A
            lat_sub_sq = ord(qth_locator[5]) - ASCII_A
        else:
            lon_sub_sq = 0
            lat_sub_sq = 0

        # Extended squares
        if len(qth_locator) == 8:
            lon_ext_sq = ord(qth_locator[6]) - ASCII_0
            lat_ext_sq = ord(qth_locator[7]) - ASCII_0
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

        return float(int(lat*10000))/10000, float(int(lon*10000))/10000
