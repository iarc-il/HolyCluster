"""add spot zone columns

Revision ID: b1c2d3e4f5a6
Revises: 68a8d1bc052f
Create Date: 2026-05-02 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, Sequence[str], None] = "68a8d1bc052f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("holy_spots2", sa.Column("spotter_cq_zone", sa.Integer(), nullable=True))
    op.add_column("holy_spots2", sa.Column("spotter_itu_zone", sa.Integer(), nullable=True))
    op.add_column("holy_spots2", sa.Column("dx_cq_zone", sa.Integer(), nullable=True))
    op.add_column("holy_spots2", sa.Column("dx_itu_zone", sa.Integer(), nullable=True))

    op.add_column("spots_with_issues2", sa.Column("spotter_cq_zone", sa.Integer(), nullable=True))
    op.add_column("spots_with_issues2", sa.Column("spotter_itu_zone", sa.Integer(), nullable=True))
    op.add_column("spots_with_issues2", sa.Column("dx_cq_zone", sa.Integer(), nullable=True))
    op.add_column("spots_with_issues2", sa.Column("dx_itu_zone", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("spots_with_issues2", "dx_itu_zone")
    op.drop_column("spots_with_issues2", "dx_cq_zone")
    op.drop_column("spots_with_issues2", "spotter_itu_zone")
    op.drop_column("spots_with_issues2", "spotter_cq_zone")

    op.drop_column("holy_spots2", "dx_itu_zone")
    op.drop_column("holy_spots2", "dx_cq_zone")
    op.drop_column("holy_spots2", "spotter_itu_zone")
    op.drop_column("holy_spots2", "spotter_cq_zone")
