import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from api.main import app
from shared.geo import GeoData, GeoException


def create_geo_data(callsign, *, cached=False, source="qrz"):
    return GeoData(
        cached=cached,
        locator_source=source,
        locator="CM87",
        lon=-122.4,
        lat=37.7,
        dxcc_code=291,
        country="USA",
        continent="NA",
        state="CA",
        cq_zone=3,
        itu_zone=6,
    )


class HunterResolveEndpointTest(unittest.TestCase):
    def setUp(self):
        app.state.valkey_client = object()
        app.state.http_client = object()
        self.client = TestClient(app)

    def test_hunter_resolve_returns_per_callsign_results(self):
        resolved_callsigns = []

        async def fake_get_geo_details(_valkey_client, _qrz_key, callsign, *_args):
            resolved_callsigns.append(callsign)
            return create_geo_data(callsign, cached=callsign == "K1ABC", source="cty")

        with (
            patch("api.main.get_qrz_session_key_from_redis", new=AsyncMock(return_value="session")),
            patch("api.main.get_geo_details", new=fake_get_geo_details),
        ):
            response = self.client.post("/hunter/resolve", json={"callsigns": ["k1abc", "VE3XYZ"]})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(resolved_callsigns, ["K1ABC", "VE3XYZ"])
        self.assertEqual(
            response.json(),
            {
                "results": {
                    "K1ABC": {
                        "callsign": "K1ABC",
                        "country": "USA",
                        "continent": "NA",
                        "state": "CA",
                        "cq_zone": 3,
                        "itu_zone": 6,
                        "locator": "CM87",
                        "lat": 37.7,
                        "lon": -122.4,
                        "source": "cache",
                    },
                    "VE3XYZ": {
                        "callsign": "VE3XYZ",
                        "country": "USA",
                        "continent": "NA",
                        "state": "CA",
                        "cq_zone": 3,
                        "itu_zone": 6,
                        "locator": "CM87",
                        "lat": 37.7,
                        "lon": -122.4,
                        "source": "cty",
                    },
                },
                "errors": {},
            },
        )

    def test_hunter_resolve_returns_partial_errors_and_skips_invalid_callsigns(self):
        resolved_callsigns = []

        async def fake_get_geo_details(_valkey_client, _qrz_key, callsign, *_args):
            resolved_callsigns.append(callsign)
            if callsign == "BAD":
                raise GeoException(callsign, "hunter_import", "locator")
            return create_geo_data(callsign)

        with (
            patch("api.main.get_qrz_session_key_from_redis", new=AsyncMock(return_value="session")),
            patch("api.main.get_geo_details", new=fake_get_geo_details),
        ):
            response = self.client.post(
                "/hunter/resolve",
                json={"callsigns": ["k1abc", "BAD", "BAD!", "K1ABC"]},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(resolved_callsigns, ["K1ABC", "BAD"])
        self.assertEqual(response.json()["results"]["K1ABC"]["callsign"], "K1ABC")
        self.assertEqual(
            response.json()["errors"],
            {
                "BAD": "locator not found",
                "BAD!": "invalid callsign",
            },
        )

    def test_hunter_resolve_rejects_more_than_100_callsigns(self):
        response = self.client.post(
            "/hunter/resolve",
            json={"callsigns": [f"K{index}ABC" for index in range(101)]},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "maximum 100 callsigns per request")

    def test_hunter_resolve_continues_without_qrz_session_key(self):
        qrz_keys = []

        async def fake_get_geo_details(_valkey_client, qrz_key, callsign, *_args):
            qrz_keys.append(qrz_key)
            return create_geo_data(callsign, source="cty")

        with (
            patch(
                "api.main.get_qrz_session_key_from_redis",
                new=AsyncMock(side_effect=HTTPException(status_code=503, detail="missing")),
            ),
            patch("api.main.get_geo_details", new=fake_get_geo_details),
        ):
            response = self.client.post("/hunter/resolve", json={"callsigns": ["K1ABC"]})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(qrz_keys, [""])
        self.assertEqual(response.json()["results"]["K1ABC"]["source"], "cty")


if __name__ == "__main__":
    unittest.main()
