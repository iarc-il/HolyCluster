from unittest.mock import patch

import pytest

from collectors.utils import retry_delay


@pytest.mark.parametrize(
    ("failure_count", "endpoint_base", "lotw_base"),
    [(1, 30, 600), (2, 60, 1200), (10, 300, 3600), (20, 300, 3600)],
)
@pytest.mark.parametrize("jitter_fraction", [0, 0.1, 0.2])
def test_endpoint_and_lotw_retry_delay(failure_count, endpoint_base, lotw_base, jitter_fraction):
    with patch("collectors.utils.random.uniform", return_value=endpoint_base * jitter_fraction) as uniform:
        assert retry_delay(30, failure_count) == min(endpoint_base * (1 + jitter_fraction), 300)
        uniform.assert_called_once_with(0, endpoint_base * 0.2)

    with patch("collectors.utils.random.uniform", return_value=lotw_base * jitter_fraction) as uniform:
        assert retry_delay(600, failure_count, 3600) == min(lotw_base * (1 + jitter_fraction), 3600)
        uniform.assert_called_once_with(0, lotw_base * 0.2)
