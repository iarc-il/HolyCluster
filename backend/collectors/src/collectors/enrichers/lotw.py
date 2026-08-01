import csv
from datetime import datetime, timedelta, timezone
from io import StringIO

import httpx

LOTW_USER_ACTIVITY_URL = "https://lotw.arrl.org/lotw-user-activity.csv"
FREQUENT_UPLOAD_AGE = timedelta(days=180)


def parse_lotw_user_activity(csv_data: str) -> dict[str, datetime]:
    users = {}

    for row in csv.reader(StringIO(csv_data)):
        if len(row) != 3:
            continue

        callsign, upload_date, upload_time = (value.strip() for value in row)
        if not callsign:
            continue

        try:
            users[callsign.upper()] = datetime.strptime(
                f"{upload_date} {upload_time}", "%Y-%m-%d %H:%M:%S"
            ).replace(tzinfo=timezone.utc)
        except ValueError:
            continue

    return users


async def fetch_lotw_user_activity() -> dict[str, datetime]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(LOTW_USER_ACTIVITY_URL)
        response.raise_for_status()

    return parse_lotw_user_activity(response.text)


def get_lotw_status(
    callsign: str, users: dict[str, datetime], now: datetime | None = None
) -> str:
    last_upload = users.get(callsign.upper())
    if last_upload is None:
        return "non_user"

    now = now or datetime.now(timezone.utc)
    if last_upload >= now - FREQUENT_UPLOAD_AGE:
        return "frequent"

    return "infrequent"
