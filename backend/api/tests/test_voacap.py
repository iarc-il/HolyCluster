import unittest

from fastapi.testclient import TestClient

from api.main import app
from api.voacap import (
    VoacapMetric,
    clear_voacap_cache,
    generate_voacap_grid,
    get_band_frequency_mhz,
    get_voacap_cache_info,
)


class VoacapServiceTest(unittest.TestCase):
    def setUp(self):
        clear_voacap_cache()

    def test_band_frequency_mapping_supports_hf_and_rejects_6m(self):
        self.assertEqual(get_band_frequency_mhz("20"), 14.15)
        self.assertEqual(get_band_frequency_mhz("20m"), 14.15)

        with self.assertRaisesRegex(ValueError, "Unsupported VOACAP band"):
            get_band_frequency_mhz("6")

    def test_generate_voacap_grid_returns_json_safe_cells_and_uses_cache(self):
        result = generate_voacap_grid(
            center_lat=32.08,
            center_lon=34.78,
            band="20",
            utc_hour=12,
            month=6,
            ssn=100,
            step_deg=30,
            metric=VoacapMetric.SNR_DB,
        )

        self.assertEqual(result["model"], "dvoacap-python")
        self.assertEqual(result["metric"], "snr_db")
        self.assertEqual(result["band"], "20")
        self.assertEqual(result["frequency_mhz"], 14.15)
        self.assertEqual(result["errors"], 0)
        self.assertEqual(len(result["cells"]), 72)
        self.assertIsInstance(result["cells"][0]["value"], float)

        cache_info = get_voacap_cache_info()
        self.assertEqual(cache_info.misses, 1)
        self.assertEqual(cache_info.hits, 0)

        generate_voacap_grid(
            center_lat=32.08,
            center_lon=34.78,
            band="20",
            utc_hour=12,
            month=6,
            ssn=100,
            step_deg=30,
            metric="snr_db",
        )

        cache_info = get_voacap_cache_info()
        self.assertEqual(cache_info.misses, 1)
        self.assertEqual(cache_info.hits, 1)


class VoacapEndpointTest(unittest.TestCase):
    def setUp(self):
        clear_voacap_cache()
        self.client = TestClient(app)

    def test_voacap_endpoint_returns_grid(self):
        response = self.client.get(
            "/voacap",
            params={
                "center_lat": 32.08,
                "center_lon": 34.78,
                "band": "20",
                "utc_hour": 12,
                "month": 6,
                "ssn": 100,
                "step_deg": 30,
            },
        )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["metric"], "snr_db")
        self.assertEqual(data["band"], "20")
        self.assertEqual(data["frequency_mhz"], 14.15)
        self.assertEqual(len(data["cells"]), 72)

    def test_voacap_endpoint_rejects_unsupported_band(self):
        response = self.client.get(
            "/voacap",
            params={
                "center_lat": 32.08,
                "center_lon": 34.78,
                "band": "6",
                "utc_hour": 12,
                "month": 6,
                "ssn": 100,
                "step_deg": 30,
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Unsupported VOACAP band: 6")


if __name__ == "__main__":
    unittest.main()
