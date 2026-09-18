"""Use timestamp for HolySpot deduplication.

Revision ID: f1a2b3c4d5e6
Revises: c8d9e0f1a2b3
Create Date: 2026-09-18 00:00:00
"""

from typing import Sequence, Union

from alembic import op


revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "c8d9e0f1a2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("uc_holy_spots2", "holy_spots2", type_="unique")
    op.create_unique_constraint(
        "uc_holy_spots2",
        "holy_spots2",
        ["timestamp", "spotter_callsign", "dx_callsign"],
    )


def downgrade() -> None:
    op.drop_constraint("uc_holy_spots2", "holy_spots2", type_="unique")
    op.create_unique_constraint(
        "uc_holy_spots2",
        "holy_spots2",
        ["time", "spotter_callsign", "dx_callsign"],
    )
