import asyncio
import importlib.util
import os
import unittest
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import MetaData, func, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from shared.coverage_samples import insert_coverage_samples, prune_coverage_samples
from shared.db import SpotCoverageSample

DATABASE_URL = os.environ.get("COVERAGE_TEST_DATABASE_URL")
MIGRATION = Path(__file__).resolve().parents[2] / "migrations/versions/2b6e9d4c1a70_add_spot_coverage_samples.py"
NOW = datetime(2026, 11, 1, 12, tzinfo=timezone.utc)


def sample(**changes):
    values = dict(
        service="external_cluster",
        direction="holy_only",
        finalized_at=NOW,
        window_started_at=NOW - timedelta(minutes=5),
        spot_time=time(11, 59),
        observed_at=NOW - timedelta(minutes=1),
        spotter_callsign="W1AW",
        dx_callsign="4X1AA",
        frequency="14074.0",
        comment="source comment",
        identity_digest="abc123",
    )
    values.update(changes)
    return SpotCoverageSample.model_validate(values)


@unittest.skipUnless(DATABASE_URL, "Set COVERAGE_TEST_DATABASE_URL to run PostgreSQL tests")
class SpotCoverageSamplePersistenceTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.schema = f"coverage_test_{uuid4().hex}"
        self.admin = create_async_engine(DATABASE_URL)
        async with self.admin.begin() as connection:
            await connection.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        self.engine = create_async_engine(DATABASE_URL, connect_args={"server_settings": {"search_path": self.schema}})
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        spec = importlib.util.spec_from_file_location("coverage_migration", MIGRATION)
        self.migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.migration)
        async with self.engine.begin() as connection:
            await connection.run_sync(self.upgrade)

    def upgrade(self, connection):
        with Operations.context(MigrationContext.configure(connection)):
            self.migration.upgrade()

    async def asyncTearDown(self):
        await self.engine.dispose()
        async with self.admin.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{self.schema}" CASCADE'))
        await self.admin.dispose()

    async def store(self, samples, **changes):
        options = dict(
            service="external_cluster", direction="holy_only", retention_cutoff=NOW - timedelta(days=1), max_samples=3
        )
        options.update(changes)
        async with self.sessions.begin() as session:
            return await insert_coverage_samples(session, samples, **options)

    async def rows(self):
        async with self.sessions() as session:
            result = await session.execute(select(SpotCoverageSample).order_by(SpotCoverageSample.id))
            return result.scalars().all()

    async def test_migration_matches_model_and_downgrades(self):
        metadata = MetaData()
        SpotCoverageSample.__table__.to_metadata(metadata)
        async with self.engine.begin() as connection:
            differences = await connection.run_sync(
                lambda conn: compare_metadata(MigrationContext.configure(conn), metadata)
            )
            self.assertEqual(differences, [])

            def downgrade(conn):
                with Operations.context(MigrationContext.configure(conn)):
                    self.migration.downgrade()

            await connection.run_sync(downgrade)
            self.assertIsNone((await connection.execute(text("SELECT to_regclass('spot_coverage_samples')"))).scalar())

    async def test_retry_and_window_identity(self):
        self.assertEqual(await self.store([sample(), sample()]), 1)
        self.assertEqual(await self.store([sample(finalized_at=NOW + timedelta(seconds=1), comment="retry")]), 0)
        self.assertEqual(await self.store([sample(window_started_at=NOW)]), 1)
        rows = await self.rows()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0].comment, "source comment")
        self.assertEqual(rows[0].observed_at, NOW - timedelta(minutes=1))
        self.assertEqual(rows[0].spot_time, time(11, 59))
        self.assertEqual(rows[0].frequency, "14074.0")

    async def test_retention_and_cap_are_scoped_and_deterministic(self):
        await self.store([sample(service="other")], service="other")
        await self.store([sample(direction="service_only")], direction="service_only")
        values = [sample(identity_digest=str(i), finalized_at=NOW - timedelta(days=i)) for i in range(5)]
        self.assertEqual(await self.store(values, max_samples=1, retention_cutoff=NOW - timedelta(days=2)), 5)
        rows = await self.rows()
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[-1].identity_digest, "0")
        async with self.sessions.begin() as session:
            self.assertEqual(
                await prune_coverage_samples(
                    session, service="external_cluster", direction="holy_only", retention_cutoff=NOW, max_samples=0
                ),
                1,
            )
        self.assertEqual(len(await self.rows()), 2)

    async def test_cutoff_boundary_and_tied_timestamps(self):
        await self.store([sample(identity_digest=str(i)) for i in range(5)], max_samples=2, retention_cutoff=NOW)
        self.assertEqual([row.identity_digest for row in await self.rows()], ["3", "4"])
        await self.store([], retention_cutoff=NOW + timedelta(microseconds=1))
        self.assertEqual(await self.rows(), [])

    async def test_concurrent_writers_keep_hard_cap(self):
        counts = await asyncio.gather(*(self.store([sample(identity_digest=str(i))], max_samples=2) for i in range(12)))
        self.assertEqual(sum(counts), 12)
        self.assertEqual(len(await self.rows()), 2)

    async def test_rollback_is_owned_by_caller(self):
        async with self.sessions() as session:
            await insert_coverage_samples(
                session,
                [sample()],
                service="external_cluster",
                direction="holy_only",
                retention_cutoff=NOW,
                max_samples=2,
            )
            await session.rollback()
        self.assertEqual(await self.rows(), [])

    async def test_invalid_input_does_not_write(self):
        for options in ({"max_samples": -1}, {"direction": "both"}, {"service": ""}, {"max_samples": 1.5}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                await self.store([sample()], **options)
        with self.assertRaises(ValueError):
            await self.store([sample(service="other")])
        with self.assertRaises(ValueError):
            await self.store([sample().model_copy(update={"direction": "both"})])
        self.assertEqual(await self.rows(), [])

    async def test_database_rejects_invalid_scope_and_duplicates(self):
        table = SpotCoverageSample.__table__
        for changes in ({"service": ""}, {"service": "x" * 65}, {"direction": "both"}):
            values = sample().model_dump(exclude={"id"}) | changes
            with self.subTest(changes=changes), self.assertRaises(DBAPIError):
                async with self.sessions.begin() as session:
                    await session.execute(table.insert().values(**values))
        await self.store([sample()])
        with self.assertRaises(IntegrityError):
            async with self.sessions.begin() as session:
                await session.execute(table.insert().values(**sample().model_dump(exclude={"id"})))
        async with self.sessions() as session:
            self.assertEqual((await session.execute(select(func.count()).select_from(table))).scalar_one(), 1)


if __name__ == "__main__":
    unittest.main()
