"""add pota spot fields

Revision ID: facd530575f1
Revises: b1c2d3e4f5a6
Create Date: 2026-06-05 00:10:16.307066

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "facd530575f1"
down_revision: Union[str, Sequence[str], None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("holy_spots2", sa.Column("pota_reference", sa.String(), nullable=True))
    op.add_column("holy_spots2", sa.Column("pota_name", sa.String(), nullable=True))
    op.add_column("holy_spots2", sa.Column("pota_description", sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("holy_spots2", "pota_description")
    op.drop_column("holy_spots2", "pota_name")
    op.drop_column("holy_spots2", "pota_reference")
