"""Add anonymous user analytics.

Revision ID: 4d8f2b0c6e31
Revises: 3c7e1a9b5d20
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "4d8f2b0c6e31"
down_revision = "3c7e1a9b5d20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP VIEW anonymous_user_counts")
    op.add_column("anonymous_user_presence", sa.Column("last_cat_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "anonymous_user_presence", sa.Column("last_direct_seen_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "anonymous_user_presence",
        sa.Column("latest_ui_version", sa.String(length=64), server_default="not_reported", nullable=False),
    )
    op.add_column(
        "anonymous_user_presence",
        sa.Column("latest_catserver_version", sa.String(length=64), server_default="not_reported", nullable=False),
    )
    op.add_column(
        "anonymous_user_presence",
        sa.Column("latest_client_type", sa.String(length=16), server_default="not_reported", nullable=False),
    )
    op.add_column(
        "anonymous_user_presence",
        sa.Column("latest_browser_type", sa.String(length=16), server_default="not_reported", nullable=False),
    )
    for column in (
        "latest_ui_version",
        "latest_catserver_version",
        "latest_client_type",
        "latest_browser_type",
    ):
        op.alter_column("anonymous_user_presence", column, server_default=None)

    op.create_table(
        "anonymous_user_day",
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_cat", sa.Boolean(), nullable=False),
        sa.Column("used_direct", sa.Boolean(), nullable=False),
        sa.Column("ui_version", sa.String(length=64), nullable=False),
        sa.Column("catserver_version", sa.String(length=64), nullable=False),
        sa.Column("client_type", sa.String(length=16), nullable=False),
        sa.Column("browser_type", sa.String(length=16), nullable=False),
        sa.PrimaryKeyConstraint("day", "user_id"),
    )
    op.create_index("ix_anonymous_user_day_day", "anonymous_user_day", ["day"])

    op.execute(
        """
        CREATE VIEW anonymous_user_counts AS
        SELECT
            count(*) FILTER (WHERE last_seen_at >= now() - interval '10 minutes') AS active_now,
            count(*) FILTER (WHERE last_seen_at >= now() - interval '24 hours') AS active_24h,
            count(*) FILTER (WHERE last_seen_at >= now() - interval '7 days') AS active_7d,
            count(*) FILTER (WHERE last_seen_at >= now() - interval '30 days') AS active_30d,
            count(*) FILTER (WHERE first_seen_at >= now() - interval '24 hours') AS new_24h,
            count(*) FILTER (WHERE first_seen_at >= now() - interval '30 days') AS new_30d,
            count(*) FILTER (
                WHERE last_seen_at >= now() - interval '7 days'
                  AND first_seen_at < now() - interval '7 days'
            ) AS returning_7d,
            count(*) FILTER (
                WHERE last_seen_at >= now() - interval '30 days'
                  AND first_seen_at < now() - interval '30 days'
            ) AS returning_30d,
            count(*) FILTER (WHERE last_cat_seen_at >= now() - interval '24 hours') AS cat_24h,
            count(*) FILTER (WHERE last_cat_seen_at >= now() - interval '7 days') AS cat_7d,
            count(*) FILTER (WHERE last_cat_seen_at >= now() - interval '30 days') AS cat_30d,
            count(*) FILTER (WHERE last_direct_seen_at >= now() - interval '24 hours') AS direct_24h,
            count(*) FILTER (WHERE last_direct_seen_at >= now() - interval '7 days') AS direct_7d,
            count(*) FILTER (WHERE last_direct_seen_at >= now() - interval '30 days') AS direct_30d,
            count(*) FILTER (
                WHERE last_cat_seen_at >= now() - interval '30 days'
                  AND last_direct_seen_at >= now() - interval '30 days'
            ) AS both_30d,
            count(*) AS total
        FROM anonymous_user_presence
        """
    )
    op.execute(
        """
        CREATE VIEW anonymous_user_activity_history AS
        SELECT
            anchor.day,
            (SELECT count(*) FROM anonymous_user_day daily WHERE daily.day = anchor.day) AS daily_active,
            (SELECT count(DISTINCT weekly.user_id) FROM anonymous_user_day weekly
             WHERE weekly.day BETWEEN anchor.day - 6 AND anchor.day) AS weekly_active,
            (SELECT count(DISTINCT monthly.user_id) FROM anonymous_user_day monthly
             WHERE monthly.day BETWEEN anchor.day - 29 AND anchor.day) AS monthly_active,
            (SELECT count(*) FROM anonymous_user_day cat
             WHERE cat.day = anchor.day AND cat.used_cat) AS cat_active,
            (SELECT count(*) FROM anonymous_user_day direct
             WHERE direct.day = anchor.day AND direct.used_direct) AS direct_active,
            (SELECT count(*) FROM anonymous_user_day both
             WHERE both.day = anchor.day AND both.used_cat AND both.used_direct) AS both_active,
            (SELECT count(*) FROM anonymous_user_presence presence
             WHERE presence.first_seen_at::date = anchor.day) AS new_installations
        FROM (SELECT DISTINCT day FROM anonymous_user_day) anchor
        """
    )
    op.execute(
        """
        CREATE VIEW anonymous_user_retention AS
        SELECT
            cohort.cohort_day,
            cohort.installations,
            CASE WHEN cohort.cohort_day <= current_date - 7 THEN
                count(*) FILTER (
                    WHERE EXISTS (
                        SELECT 1 FROM anonymous_user_day daily
                        WHERE daily.user_id = cohort.user_id
                          AND daily.day BETWEEN cohort.cohort_day + 1 AND cohort.cohort_day + 7
                    )
                )
            END AS returned_7d,
            CASE WHEN cohort.cohort_day <= current_date - 30 THEN
                count(*) FILTER (
                    WHERE EXISTS (
                        SELECT 1 FROM anonymous_user_day daily
                        WHERE daily.user_id = cohort.user_id
                          AND daily.day BETWEEN cohort.cohort_day + 1 AND cohort.cohort_day + 30
                    )
                )
            END AS returned_30d
        FROM (
            SELECT
                user_id,
                first_seen_at::date AS cohort_day,
                count(*) OVER (PARTITION BY first_seen_at::date) AS installations
            FROM anonymous_user_presence
        ) cohort
        GROUP BY cohort.cohort_day, cohort.installations
        """
    )
    op.execute(
        """
        CREATE VIEW anonymous_ui_version_counts AS
        SELECT latest_ui_version AS version, count(*) AS installations
        FROM anonymous_user_presence
        WHERE last_seen_at >= now() - interval '30 days'
        GROUP BY latest_ui_version
        """
    )
    op.execute(
        """
        CREATE VIEW anonymous_catserver_version_counts AS
        SELECT latest_catserver_version AS version, count(*) AS installations
        FROM anonymous_user_presence
        WHERE last_seen_at >= now() - interval '30 days'
        GROUP BY latest_catserver_version
        """
    )
    op.execute(
        """
        CREATE VIEW anonymous_ui_version_history AS
        SELECT day, ui_version AS version, count(*) AS installations
        FROM anonymous_user_day
        GROUP BY day, ui_version
        """
    )
    op.execute(
        """
        CREATE VIEW anonymous_catserver_version_history AS
        SELECT day, catserver_version AS version, count(*) AS installations
        FROM anonymous_user_day
        GROUP BY day, catserver_version
        """
    )


def downgrade() -> None:
    op.execute("DROP VIEW anonymous_catserver_version_history")
    op.execute("DROP VIEW anonymous_ui_version_history")
    op.execute("DROP VIEW anonymous_catserver_version_counts")
    op.execute("DROP VIEW anonymous_ui_version_counts")
    op.execute("DROP VIEW anonymous_user_retention")
    op.execute("DROP VIEW anonymous_user_activity_history")
    op.execute("DROP VIEW anonymous_user_counts")
    op.drop_index("ix_anonymous_user_day_day", table_name="anonymous_user_day")
    op.drop_table("anonymous_user_day")
    op.drop_column("anonymous_user_presence", "latest_browser_type")
    op.drop_column("anonymous_user_presence", "latest_client_type")
    op.drop_column("anonymous_user_presence", "latest_catserver_version")
    op.drop_column("anonymous_user_presence", "latest_ui_version")
    op.drop_column("anonymous_user_presence", "last_direct_seen_at")
    op.drop_column("anonymous_user_presence", "last_cat_seen_at")
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
