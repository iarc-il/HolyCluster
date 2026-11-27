"""add dx callsign timestamp index

Revision ID: 8c8575c58b58
Revises: 4d8f2b0c6e31
Create Date: 2026-11-01 16:10:12.924074

"""

from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "8c8575c58b58"
down_revision: Union[str, Sequence[str], None] = "4d8f2b0c6e31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Build concurrently so the running collector can keep inserting spots meanwhile
    with op.get_context().autocommit_block():
        op.create_index(
            "ix_holy_spots2_dx_callsign_timestamp",
            "holy_spots2",
            ["dx_callsign", "timestamp"],
            unique=False,
            postgresql_concurrently=True,
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.get_context().autocommit_block():
        op.drop_index(
            "ix_holy_spots2_dx_callsign_timestamp",
            table_name="holy_spots2",
            postgresql_concurrently=True,
        )
