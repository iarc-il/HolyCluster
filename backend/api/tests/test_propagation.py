import unittest
from datetime import UTC, datetime

from api.propagation import (
    latest_propagation_from_history,
    parse_a_index_history,
    parse_k_index_history,
    parse_sfi_history,
)


def timestamp(year, month, day, hour=0):
    return int(datetime(year, month, day, hour, tzinfo=UTC).timestamp())


class PropagationParserTest(unittest.TestCase):
    def test_parse_k_index_history_returns_sorted_valid_samples(self):
        samples = parse_k_index_history(
            [
                {"time_tag": "2026-06-16T03:00:00", "Kp": 1.33},
                {"time_tag": "2026-06-16T00:00:00", "Kp": "2.00"},
                {"time_tag": "2026-06-16T06:00:00", "Kp": -1},
            ]
        )

        self.assertEqual(
            samples,
            [
                {"value": 2.0, "timestamp": timestamp(2026, 6, 16)},
                {"value": 1.33, "timestamp": timestamp(2026, 6, 16, 3)},
            ],
        )

    def test_parse_a_index_history_reads_daily_planetary_a_values(self):
        text_data = """
:Product: Daily Geomagnetic Data          DGD.txt
#  Date        A     K-indices        A     K-indices        A     K-indices
2026 06 14    -1 -1-1-1-1-1-1-1-1     9  2 2 2 4 2 2 2 1     6   2.33  2.00  1.33  2.00  1.67  1.67  1.33  1.33
2026 06 15     6  2 1 1 2 2 2 2 2     2  2 1 0 1 0 0 1 1     7   2.00  1.67  1.33  1.67  1.00  0.67  1.67  2.00
2026 06 16    -1  2 1 1-1-1-1-1-1    -1  2 1 1-1-1-1-1-1    -1   2.00  1.33  1.00 -1.00 -1.00 -1.00 -1.00 -1.00
"""

        samples = parse_a_index_history(text_data)

        self.assertEqual(
            samples,
            [
                {"value": 6, "timestamp": timestamp(2026, 6, 14)},
                {"value": 7, "timestamp": timestamp(2026, 6, 15)},
            ],
        )

    def test_parse_sfi_history_returns_sorted_valid_samples(self):
        samples = parse_sfi_history(
            [
                {"time_tag": "2026-06-15T20:00:00", "flux": 117.0},
                {"time_tag": "2026-06-14T20:00:00", "flux": 128.0},
                {"time_tag": "2026-06-16T20:00:00", "flux": -1},
            ]
        )

        self.assertEqual(
            samples,
            [
                {"value": 128, "timestamp": timestamp(2026, 6, 14, 20)},
                {"value": 117, "timestamp": timestamp(2026, 6, 15, 20)},
            ],
        )

    def test_latest_propagation_from_history_keeps_current_response_shape(self):
        latest = latest_propagation_from_history(
            {
                "k_index": [
                    {"value": 2.0, "timestamp": timestamp(2026, 6, 16)},
                    {"value": 1.33, "timestamp": timestamp(2026, 6, 16, 3)},
                ],
                "a_index": [],
                "sfi": [{"value": 117, "timestamp": timestamp(2026, 6, 15, 20)}],
            }
        )

        self.assertEqual(latest["k_index"], {"value": 1.33, "timestamp": timestamp(2026, 6, 16, 3)})
        self.assertEqual(latest["a_index"], {"error": "no data"})
        self.assertEqual(latest["sfi"], {"value": 117, "timestamp": timestamp(2026, 6, 15, 20)})


if __name__ == "__main__":
    unittest.main()
