import re
import csv
from typing import List 



class Position:
    def __init__(self, lat:float, lon:float):
        self.lat = lat
        self.lon = lon
    def __str__(self):
        return f"{self.lat},{self.lon}"


def read_csv_to_list_of_tuples(filename: str):
    with open(filename, 'r') as file:
        csv_reader = csv.reader(file)
        return [tuple(row) for row in csv_reader]


def resolve_locator(callsign:str, callsigns_to_locators:List) -> str:
    callsign=callsign.upper()
    for regex, locator in callsigns_to_locators:
        if re.match(regex+".*", callsign):
            return locator
    return None


def get_locator_from_qrz(callsign:str) -> str:
    ...
