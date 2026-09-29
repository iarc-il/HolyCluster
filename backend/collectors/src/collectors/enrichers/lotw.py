import csv
import json
from datetime import datetime, timedelta, timezone
from io import StringIO

import httpx

LOTW_USER_ACTIVITY_URL = "https://lotw.arrl.org/lotw-user-activity.csv"
FREQUENT_UPLOAD_AGE = timedelta(days=180)


class LotwResponseError(Exception):
    pass


def parse_lotw_user_activity(csv_data: str) -> dict[str, datetime]:
    users = {}

    for row in csv.reader(StringIO(csv_data)):
        if len(row) != 3:
            continue

        callsign, upload_date, upload_time = (value.strip() for value in row)
        if not callsign:
            continue

        try:
            users[callsign.upper()] = datetime.strptime(f"{upload_date} {upload_time}", "%Y-%m-%d %H:%M:%S").replace(
                tzinfo=timezone.utc
            )
        except ValueError:
            continue

    return users


def serialize_lotw_user_activity(users: dict[str, datetime]) -> str:
    return json.dumps({callsign: uploaded_at.isoformat() for callsign, uploaded_at in users.items()})


def deserialize_lotw_user_activity(data: str) -> dict[str, datetime]:
    try:
        values = json.loads(data)
    except (TypeError, json.JSONDecodeError):
        return {}
    if not isinstance(values, dict):
        return {}

    users = {}
    for callsign, uploaded_at in values.items():
        if not isinstance(callsign, str) or not isinstance(uploaded_at, str):
            continue
        try:
            parsed = datetime.fromisoformat(uploaded_at)
        except ValueError:
            continue
        if parsed.tzinfo is not None:
            users[callsign] = parsed
    return users


async def fetch_lotw_user_activity() -> dict[str, datetime]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(LOTW_USER_ACTIVITY_URL)
        response.raise_for_status()

    users = parse_lotw_user_activity(response.text)
    if not users:
        raise LotwResponseError("LoTW user activity response contained no valid records")
    return users


def get_lotw_status(callsign: str, users: dict[str, datetime], now: datetime | None = None) -> str:
    last_upload = users.get(callsign.upper())
    if last_upload is None:
        return "non_user"

    now = now or datetime.now(timezone.utc)
    if last_upload >= now - FREQUENT_UPLOAD_AGE:
        return "frequent"

    return "infrequent"
