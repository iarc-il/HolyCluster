from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from shared.db import AnonymousUserDay, AnonymousUserPresence

from .metrics import browser_type, client_type, client_version


@dataclass(frozen=True)
class UserPresenceObservation:
    user_id: UUID
    ui_version: str
    catserver_version: str
    client_type: str
    browser_type: str
    used_cat: bool
    used_direct: bool


def parse_user_presence(message) -> UserPresenceObservation | None:
    value = message.get("user_id")
    if not isinstance(value, str) or len(value) != 36:
        return None
    try:
        user_id = UUID(value)
    except ValueError:
        return None
    if user_id.version != 4 or str(user_id) != value.lower():
        return None

    ui_version = client_version(message, "ui_version")
    catserver_version = client_version(message, "catserver_version")
    return UserPresenceObservation(
        user_id=user_id,
        ui_version=ui_version,
        catserver_version=catserver_version,
        client_type=client_type(message),
        browser_type=browser_type(message),
        used_cat=catserver_version.startswith("catserver-v"),
        used_direct=catserver_version == "none",
    )


def merge_observations(observations: set[UserPresenceObservation]) -> dict[UUID, UserPresenceObservation]:
    merged = {}
    for observation in sorted(
        observations,
        key=lambda item: (
            item.user_id,
            item.used_cat,
            item.ui_version,
            item.catserver_version,
            item.client_type,
            item.browser_type,
        ),
    ):
        previous = merged.get(observation.user_id)
        if previous is None:
            merged[observation.user_id] = observation
            continue
        merged[observation.user_id] = UserPresenceObservation(
            user_id=observation.user_id,
            ui_version=observation.ui_version,
            catserver_version=observation.catserver_version,
            client_type=observation.client_type,
            browser_type=observation.browser_type,
            used_cat=previous.used_cat or observation.used_cat,
            used_direct=previous.used_direct or observation.used_direct,
        )
    return merged


async def upsert_user_presence(session_factory, observations: set[UserPresenceObservation]) -> datetime | None:
    if not observations:
        return None

    observed_at = datetime.now(UTC)
    day = observed_at.date()
    latest = merge_observations(observations)
    presence_rows = [
        {
            "user_id": observation.user_id,
            "first_seen_at": observed_at,
            "last_seen_at": observed_at,
            "last_cat_seen_at": observed_at if observation.used_cat else None,
            "last_direct_seen_at": observed_at if observation.used_direct else None,
            "latest_ui_version": observation.ui_version,
            "latest_catserver_version": observation.catserver_version,
            "latest_client_type": observation.client_type,
            "latest_browser_type": observation.browser_type,
        }
        for observation in latest.values()
    ]
    presence = pg_insert(AnonymousUserPresence.__table__).values(presence_rows)
    presence = presence.on_conflict_do_update(
        index_elements=[AnonymousUserPresence.user_id],
        set_={
            "last_seen_at": presence.excluded.last_seen_at,
            "last_cat_seen_at": func.coalesce(
                presence.excluded.last_cat_seen_at,
                AnonymousUserPresence.__table__.c.last_cat_seen_at,
            ),
            "last_direct_seen_at": func.coalesce(
                presence.excluded.last_direct_seen_at,
                AnonymousUserPresence.__table__.c.last_direct_seen_at,
            ),
            "latest_ui_version": presence.excluded.latest_ui_version,
            "latest_catserver_version": presence.excluded.latest_catserver_version,
            "latest_client_type": presence.excluded.latest_client_type,
            "latest_browser_type": presence.excluded.latest_browser_type,
        },
    )

    daily_rows = [
        {
            "day": day,
            "user_id": observation.user_id,
            "first_seen_at": observed_at,
            "last_seen_at": observed_at,
            "used_cat": observation.used_cat,
            "used_direct": observation.used_direct,
            "ui_version": observation.ui_version,
            "catserver_version": observation.catserver_version,
            "client_type": observation.client_type,
            "browser_type": observation.browser_type,
        }
        for observation in latest.values()
    ]
    daily = pg_insert(AnonymousUserDay.__table__).values(daily_rows)
    daily = daily.on_conflict_do_update(
        index_elements=[AnonymousUserDay.day, AnonymousUserDay.user_id],
        set_={
            "last_seen_at": daily.excluded.last_seen_at,
            "used_cat": AnonymousUserDay.__table__.c.used_cat | daily.excluded.used_cat,
            "used_direct": AnonymousUserDay.__table__.c.used_direct | daily.excluded.used_direct,
            "ui_version": daily.excluded.ui_version,
            "catserver_version": daily.excluded.catserver_version,
            "client_type": daily.excluded.client_type,
            "browser_type": daily.excluded.browser_type,
        },
    )

    async with session_factory() as session:
        await session.execute(presence)
        await session.execute(daily)
        await session.commit()
    return observed_at
