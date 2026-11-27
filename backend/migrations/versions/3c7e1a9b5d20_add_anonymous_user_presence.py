"""Add anonymous user presence.

Revision ID: 3c7e1a9b5d20
Revises: 2b6e9d4c1a70
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "3c7e1a9b5d20"
down_revision = "2b6e9d4c1a70"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "anonymous_user_presence",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_index(
        "ix_anonymous_user_presence_last_seen_at",
        "anonymous_user_presence",
        ["last_seen_at"],
    )
    op.execute(
        """
        CREATE VIEW anonymous_user_counts AS
        SELECT
            count(*) FILTER (WHERE last_seen_at >= now() - interval '10 minutes') AS active_now,
            count(*) FILTER (WHERE last_seen_at >= now() - interval '24 hours') AS active_24h,
            count(*) FILTER (WHERE last_seen_at >= now() - interval '7 days') AS active_7d,
            count(*) FILTER (WHERE last_seen_at >= now() - interval '30 days') AS active_30d,
            count(*) AS total
        FROM anonymous_user_presence
        """
    )


def downgrade() -> None:
    op.execute("DROP VIEW anonymous_user_counts")
    op.drop_index("ix_anonymous_user_presence_last_seen_at", table_name="anonymous_user_presence")
    op.drop_table("anonymous_user_presence")
