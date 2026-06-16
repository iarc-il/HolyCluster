"""add propagation measurements

Revision ID: a9b8c7d6e5f4
Revises: e8f0a1b2c3d4
Create Date: 2026-06-16 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a9b8c7d6e5f4"
down_revision: Union[str, Sequence[str], None] = "e8f0a1b2c3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "propagation_measurements",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("metric", sa.String(), nullable=False),
        sa.Column("timestamp", sa.Integer(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("collected_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("metric", "timestamp", name="uc_propagation_measurements_metric_timestamp"),
    )
    op.create_index(
        "ix_propagation_measurements_timestamp",
        "propagation_measurements",
        ["timestamp"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_propagation_measurements_timestamp", table_name="propagation_measurements")
    op.drop_table("propagation_measurements")
