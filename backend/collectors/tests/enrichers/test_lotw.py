import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[3]))

from collectors.enrichers.lotw import get_lotw_status, parse_lotw_user_activity


def test_parse_lotw_user_activity_skips_invalid_rows():
    users = parse_lotw_user_activity(
        "K1ABC,2026-07-31,20:15:52\n"
        "invalid\n"
        "K2ABC,not-a-date,20:15:52\n"
        "K3ABC,2026-07-30,12:00:00\n"
    )

    assert users == {
        "K1ABC": datetime(2026, 7, 31, 20, 15, 52, tzinfo=timezone.utc),
        "K3ABC": datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc),
    }


def test_get_lotw_status_classifies_frequent_infrequent_and_non_users():
    now = datetime(2026, 8, 1, tzinfo=timezone.utc)
    users = {
        "K1ABC": now - timedelta(days=180),
        "K2ABC": now - timedelta(days=181),
    }

    assert get_lotw_status("k1abc", users, now) == "frequent"
    assert get_lotw_status("K2ABC", users, now) == "infrequent"
    assert get_lotw_status("K3ABC", users, now) == "non_user"
