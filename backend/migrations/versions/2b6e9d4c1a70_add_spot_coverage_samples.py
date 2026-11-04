"""Add spot coverage samples.

Revision ID: 2b6e9d4c1a70
Revises: c8d9e0f1a2b3
"""

from alembic import op
import sqlalchemy as sa

revision = "2b6e9d4c1a70"
down_revision = "c8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "spot_coverage_samples",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("service", sa.String(length=64), nullable=False),
        sa.Column("direction", sa.String(length=12), nullable=False),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("spot_time", sa.Time(), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("spotter_callsign", sa.String(), nullable=False),
        sa.Column("dx_callsign", sa.String(), nullable=False),
        sa.Column("frequency", sa.String(), nullable=False),
        sa.Column("comment", sa.String(), nullable=False),
        sa.Column("identity_digest", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("length(service) BETWEEN 1 AND 64", name="ck_spot_coverage_samples_service"),
        sa.CheckConstraint("direction IN ('holy_only', 'service_only')", name="ck_spot_coverage_samples_direction"),
        sa.UniqueConstraint(
            "service", "direction", "identity_digest", "window_started_at", name="uc_spot_coverage_samples"
        ),
    )
    op.create_index(
        "ix_spot_coverage_samples_latest", "spot_coverage_samples", ["service", "direction", "finalized_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_spot_coverage_samples_latest", table_name="spot_coverage_samples")
    op.drop_table("spot_coverage_samples")
