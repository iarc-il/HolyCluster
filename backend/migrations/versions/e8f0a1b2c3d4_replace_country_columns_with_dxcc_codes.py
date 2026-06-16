"""replace country columns with dxcc codes

Revision ID: e8f0a1b2c3d4
Revises: d7e8f9a0b1c2
Create Date: 2026-06-15 16:30:00.000000

"""

import asyncio
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import re

from shared.cty import CtyResolver, load_cty_resolver, ensure_cty_available


# revision identifiers, used by Alembic.
revision: str = "e8f0a1b2c3d4"
down_revision: Union[str, Sequence[str], None] = "d7e8f9a0b1c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_COUNTRY_NAME_ALIASES = {
    "agalegaandstbrandon": "agalegaandstbrandonislands",
    "amsterdamandstpaulis": "amsterdamandstpaulislands",
    "asiaticturkey": "turkey",
    "bosniaherzegovina": "bosniaandherzegovina",
    "bouvet": "bouvetisland",
    "bruneidarussalam": "brunei",
    "congodemrepublicof": "democraticrepublicofthecongo",
    "cotedivoire": "ivorycoast",
    "demrepofthecongo": "democraticrepublicofthecongo",
    "dprofkorea": "northkorea",
    "fedrepofgermany": "germany",
    "juandenovaisland": "juandenovaandeuropa",
    "kingdomofeswatini": "eswatini",
    "nzsubantarcticis": "newzealandsubantarcticislands",
    "republicofkorea": "southkorea",
    "republicofkosovo": "kosovo",
    "republicofsouthsudan": "southsudan",
    "republicofthecongo": "congo",
    "southgeorgiaislands": "southgeorgiaisland",
    "stbarthelemy": "saintbarthelemy",
    "stlucia": "saintlucia",
    "stmaarten": "sintmaarten",
    "stmartin": "saintmartin",
    "stpierreandmiquelon": "saintpierreandmiquelon",
    "stvincent": "saintvincentandthegrenadines",
    "sovmilorderofmalta": "sovereignmilitaryorderofmalta",
    "ukbaseareasoncyprus": "uksovereignbaseareasoncyprus",
    "usa": "unitedstatesofamerica",
    "unitedstates": "unitedstatesofamerica",
    "usvirginislands": "virginislands",
}


def _load_required_cty_resolver() -> CtyResolver:
    try:
        return load_cty_resolver()
    except FileNotFoundError as e:
        raise RuntimeError("CTY cache is required to migrate country columns to DXCC codes") from e


def _canonical_country_name(country: str) -> str:
    normalized = country.casefold().replace("&", "and")
    normalized = re.sub(r"[^a-z0-9]+", "", normalized)
    return _COUNTRY_NAME_ALIASES.get(normalized, normalized)


def _build_dxcc_code_lookup(resolver: CtyResolver) -> tuple[dict[tuple[str, str], int], dict[str, int]]:
    codes_by_country_continent = {}
    codes_by_country = {}
    for entity in resolver.entities_by_dxcc_code.values():
        country_key = _canonical_country_name(entity.country)
        codes_by_country_continent.setdefault((country_key, entity.continent), entity.dxcc_code)
        codes_by_country.setdefault(country_key, entity.dxcc_code)
    return codes_by_country_continent, codes_by_country


def _resolve_dxcc_code(
    resolver: CtyResolver,
    lookup: tuple[dict[tuple[str, str], int], dict[str, int]],
    callsign: str,
    country: str | None,
    continent: str | None,
) -> int | None:
    entity = resolver.resolve_entity(callsign)
    if entity is not None:
        return entity.dxcc_code

    if not country:
        return None

    codes_by_country_continent, codes_by_country = lookup
    country_key = _canonical_country_name(country)
    if continent:
        dxcc_code = codes_by_country_continent.get((country_key, continent))
        if dxcc_code is not None:
            return dxcc_code
    return codes_by_country.get(country_key)


def _country_for_dxcc_code(resolver: CtyResolver, dxcc_code: int | None) -> str | None:
    if dxcc_code is None:
        return None
    entity = resolver.get_entity_by_dxcc_code(dxcc_code)
    return entity.country if entity is not None else None


def _backfill_holy_spots(
    connection,
    resolver: CtyResolver,
    lookup: tuple[dict[tuple[str, str], int], dict[str, int]],
) -> None:
    unresolved = []
    rows = connection.execute(
        sa.text(
            "SELECT id, spotter_callsign, spotter_country, spotter_continent, "
            "dx_callsign, dx_country, dx_continent "
            "FROM holy_spots2"
        )
    ).mappings()
    for row in rows:
        spotter_dxcc_code = _resolve_dxcc_code(
            resolver,
            lookup,
            row["spotter_callsign"],
            row["spotter_country"],
            row["spotter_continent"],
        )
        dx_dxcc_code = _resolve_dxcc_code(
            resolver,
            lookup,
            row["dx_callsign"],
            row["dx_country"],
            row["dx_continent"],
        )
        if spotter_dxcc_code is None:
            unresolved.append(f"holy_spots2.id={row['id']} spotter={row['spotter_callsign']}")
        if dx_dxcc_code is None:
            unresolved.append(f"holy_spots2.id={row['id']} dx={row['dx_callsign']}")
        if spotter_dxcc_code is not None and dx_dxcc_code is not None:
            connection.execute(
                sa.text(
                    "UPDATE holy_spots2 "
                    "SET spotter_dxcc_code = :spotter_dxcc_code, dx_dxcc_code = :dx_dxcc_code "
                    "WHERE id = :id"
                ),
                {
                    "id": row["id"],
                    "spotter_dxcc_code": spotter_dxcc_code,
                    "dx_dxcc_code": dx_dxcc_code,
                },
            )

    if unresolved:
        raise RuntimeError("Cannot backfill DXCC codes: " + ", ".join(unresolved[:20]))


def _backfill_spots_with_issues(
    connection,
    resolver: CtyResolver,
    lookup: tuple[dict[tuple[str, str], int], dict[str, int]],
) -> None:
    rows = connection.execute(
        sa.text(
            "SELECT id, spotter_callsign, spotter_country, spotter_continent, "
            "dx_callsign, dx_country, dx_continent "
            "FROM spots_with_issues2"
        )
    ).mappings()
    for row in rows:
        connection.execute(
            sa.text(
                "UPDATE spots_with_issues2 "
                "SET spotter_dxcc_code = :spotter_dxcc_code, dx_dxcc_code = :dx_dxcc_code "
                "WHERE id = :id"
            ),
            {
                "id": row["id"],
                "spotter_dxcc_code": _resolve_dxcc_code(
                    resolver,
                    lookup,
                    row["spotter_callsign"],
                    row["spotter_country"],
                    row["spotter_continent"],
                ),
                "dx_dxcc_code": _resolve_dxcc_code(
                    resolver,
                    lookup,
                    row["dx_callsign"],
                    row["dx_country"],
                    row["dx_continent"],
                ),
            },
        )


def _backfill_geo_cache(
    connection,
    resolver: CtyResolver,
    lookup: tuple[dict[tuple[str, str], int], dict[str, int]],
) -> None:
    unresolved = []
    rows = connection.execute(sa.text("SELECT callsign, country, continent FROM geo_cache")).mappings()
    for row in rows:
        dxcc_code = _resolve_dxcc_code(resolver, lookup, row["callsign"], row["country"], row["continent"])
        if dxcc_code is None:
            unresolved.append(f"geo_cache.callsign={row['callsign']}")
            continue
        connection.execute(
            sa.text("UPDATE geo_cache SET dxcc_code = :dxcc_code WHERE callsign = :callsign"),
            {"callsign": row["callsign"], "dxcc_code": dxcc_code},
        )

    if unresolved:
        raise RuntimeError("Cannot backfill GeoCache DXCC codes: " + ", ".join(unresolved[:20]))


def upgrade() -> None:
    """Upgrade schema."""
    asyncio.run(ensure_cty_available())
    resolver = _load_required_cty_resolver()
    lookup = _build_dxcc_code_lookup(resolver)
    connection = op.get_bind()

    op.add_column("holy_spots2", sa.Column("spotter_dxcc_code", sa.Integer(), nullable=True))
    op.add_column("holy_spots2", sa.Column("dx_dxcc_code", sa.Integer(), nullable=True))
    op.add_column("spots_with_issues2", sa.Column("spotter_dxcc_code", sa.Integer(), nullable=True))
    op.add_column("spots_with_issues2", sa.Column("dx_dxcc_code", sa.Integer(), nullable=True))
    op.add_column("geo_cache", sa.Column("dxcc_code", sa.Integer(), nullable=True))

    _backfill_holy_spots(connection, resolver, lookup)
    _backfill_spots_with_issues(connection, resolver, lookup)
    _backfill_geo_cache(connection, resolver, lookup)

    op.alter_column("holy_spots2", "spotter_dxcc_code", existing_type=sa.Integer(), nullable=False)
    op.alter_column("holy_spots2", "dx_dxcc_code", existing_type=sa.Integer(), nullable=False)
    op.alter_column("geo_cache", "dxcc_code", existing_type=sa.Integer(), nullable=False)

    op.drop_column("holy_spots2", "spotter_country")
    op.drop_column("holy_spots2", "dx_country")
    op.drop_column("spots_with_issues2", "spotter_country")
    op.drop_column("spots_with_issues2", "dx_country")
    op.drop_column("geo_cache", "country")


def _restore_country_columns(connection, resolver: CtyResolver) -> None:
    unresolved = []
    rows = connection.execute(sa.text("SELECT id, spotter_dxcc_code, dx_dxcc_code FROM holy_spots2")).mappings()
    for row in rows:
        spotter_country = _country_for_dxcc_code(resolver, row["spotter_dxcc_code"])
        dx_country = _country_for_dxcc_code(resolver, row["dx_dxcc_code"])
        if spotter_country is None:
            unresolved.append(f"holy_spots2.id={row['id']} spotter_dxcc_code={row['spotter_dxcc_code']}")
        if dx_country is None:
            unresolved.append(f"holy_spots2.id={row['id']} dx_dxcc_code={row['dx_dxcc_code']}")
        if spotter_country is not None and dx_country is not None:
            connection.execute(
                sa.text(
                    "UPDATE holy_spots2 SET spotter_country = :spotter_country, dx_country = :dx_country WHERE id = :id"
                ),
                {"id": row["id"], "spotter_country": spotter_country, "dx_country": dx_country},
            )

    if unresolved:
        raise RuntimeError("Cannot restore country columns: " + ", ".join(unresolved[:20]))

    rows = connection.execute(sa.text("SELECT id, spotter_dxcc_code, dx_dxcc_code FROM spots_with_issues2")).mappings()
    for row in rows:
        connection.execute(
            sa.text(
                "UPDATE spots_with_issues2 "
                "SET spotter_country = :spotter_country, dx_country = :dx_country "
                "WHERE id = :id"
            ),
            {
                "id": row["id"],
                "spotter_country": _country_for_dxcc_code(resolver, row["spotter_dxcc_code"]) or "Unknown",
                "dx_country": _country_for_dxcc_code(resolver, row["dx_dxcc_code"]) or "Unknown",
            },
        )

    rows = connection.execute(sa.text("SELECT callsign, dxcc_code FROM geo_cache")).mappings()
    for row in rows:
        country = _country_for_dxcc_code(resolver, row["dxcc_code"])
        if country is None:
            unresolved.append(f"geo_cache.callsign={row['callsign']} dxcc_code={row['dxcc_code']}")
            continue
        connection.execute(
            sa.text("UPDATE geo_cache SET country = :country WHERE callsign = :callsign"),
            {"callsign": row["callsign"], "country": country},
        )

    if unresolved:
        raise RuntimeError("Cannot restore GeoCache country columns: " + ", ".join(unresolved[:20]))


def downgrade() -> None:
    """Downgrade schema."""
    resolver = _load_required_cty_resolver()
    connection = op.get_bind()

    op.add_column("geo_cache", sa.Column("country", sa.String(), nullable=True))
    op.add_column("spots_with_issues2", sa.Column("dx_country", sa.String(), nullable=True))
    op.add_column("spots_with_issues2", sa.Column("spotter_country", sa.String(), nullable=True))
    op.add_column("holy_spots2", sa.Column("dx_country", sa.String(), nullable=True))
    op.add_column("holy_spots2", sa.Column("spotter_country", sa.String(), nullable=True))

    _restore_country_columns(connection, resolver)

    op.alter_column("holy_spots2", "spotter_country", existing_type=sa.String(), nullable=False)
    op.alter_column("holy_spots2", "dx_country", existing_type=sa.String(), nullable=False)
    op.alter_column("spots_with_issues2", "spotter_country", existing_type=sa.String(), nullable=False)
    op.alter_column("spots_with_issues2", "dx_country", existing_type=sa.String(), nullable=False)
    op.alter_column("geo_cache", "country", existing_type=sa.String(), nullable=False)

    op.drop_column("geo_cache", "dxcc_code")
    op.drop_column("spots_with_issues2", "dx_dxcc_code")
    op.drop_column("spots_with_issues2", "spotter_dxcc_code")
    op.drop_column("holy_spots2", "dx_dxcc_code")
    op.drop_column("holy_spots2", "spotter_dxcc_code")
