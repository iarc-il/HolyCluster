from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.dialects.postgresql import insert as pg_insert

from shared.db import AnonymousUserPresence


def parse_user_id(message) -> UUID | None:
    value = message.get("user_id")
    if not isinstance(value, str) or len(value) != 36:
        return None
    try:
        user_id = UUID(value)
    except ValueError:
        return None
    if user_id.version != 4 or str(user_id) != value.lower():
        return None
    return user_id


async def upsert_user_presence(session_factory, user_ids: set[UUID]) -> datetime | None:
    if not user_ids:
        return None

    observed_at = datetime.now(UTC)
    rows = [{"user_id": user_id, "first_seen_at": observed_at, "last_seen_at": observed_at} for user_id in user_ids]
    statement = pg_insert(AnonymousUserPresence.__table__).values(rows)
    statement = statement.on_conflict_do_update(
        index_elements=[AnonymousUserPresence.user_id],
        set_={"last_seen_at": statement.excluded.last_seen_at},
    )
    async with session_factory() as session:
        await session.execute(statement)
        await session.commit()
    return observed_at
