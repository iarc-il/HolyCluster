import os
import unittest
from datetime import UTC, datetime, time, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from pydantic import ValidationError
from shared.db import SpotCoverageSample
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from coverage_comparator.postgres_samples import PostgresSampleSink, sample_row
from coverage_comparator.settings import Settings

NOW = datetime(2026, 11, 1, 12, tzinfo=UTC)
SAMPLE = {
    "service": "dxsummit",
    "result": "holy_only",
    "opened": NOW.timestamp() - 60,
    "finalized": NOW.timestamp(),
    "spot": {
        "time": "1159Z",
        "spotter_callsign": "W1AW",
        "dx_callsign": "4X1AA",
        "frequency": 14074.0,
        "comment": "CQ — test",
    },
}


class MappingTests(unittest.TestCase):
    def test_mapping_and_stable_identity(self):
        row = sample_row("stable-key", SAMPLE)
        retry = sample_row("stable-key", {**SAMPLE, "finalized": NOW.timestamp() + 10})
        self.assertEqual(row.identity_digest, retry.identity_digest)
        self.assertEqual(len(row.identity_digest), 64)
        self.assertNotEqual(row.identity_digest, sample_row("other-key", SAMPLE).identity_digest)
        self.assertEqual(row.direction, "holy_only")
        self.assertEqual(row.service, "dxsummit")
        self.assertEqual(row.spot_time, time(11, 59))
        self.assertEqual(row.window_started_at, NOW - timedelta(minutes=1))
        self.assertEqual(row.observed_at, row.window_started_at)
        self.assertEqual(row.finalized_at, NOW)
        self.assertEqual(row.frequency, "14074.0")
        self.assertEqual(row.comment, "CQ — test")
        self.assertEqual(row.dx_callsign, "4X1AA")
        self.assertEqual(row.spotter_callsign, "W1AW")

    def test_observation_metadata(self):
        for key, value in (
            ("timestamp", NOW.timestamp()),
            ("observed_at", "2026-11-01T14:00:00+02:00"),
            ("observed_at", NOW),
        ):
            with self.subTest(key=key, value=value):
                row = sample_row("id", {**SAMPLE, "spot": {**SAMPLE["spot"], key: value, "time": "1159"}})
                self.assertEqual(row.observed_at, NOW)
                self.assertEqual(row.observed_at.tzinfo, UTC)

    def test_reject_bad_source_time(self):
        for value in ("2400Z", "1260Z", "120Z", "noon", 1200, "12:00", "１２３４", "1234ZZ", None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                sample_row("id", {**SAMPLE, "spot": {**SAMPLE["spot"], "time": value}})

    def test_reject_bad_metadata_and_scope(self):
        for value in ("bad", "2026-11-01T12:00:00", datetime(2026, 11, 1)):
            with self.subTest(value=value), self.assertRaises(ValueError):
                sample_row("id", {**SAMPLE, "spot": {**SAMPLE["spot"], "observed_at": value}})
        for changes in ({"service": "unknown"}, {"result": "matched"}):
            with self.assertRaises(ValueError):
                sample_row("id", {**SAMPLE, **changes})

    def test_settings_limits(self):
        # Supply all required inherited values without reading a local .env file.
        required = {key: "test" for key, field in Settings.model_fields.items() if field.is_required()}
        required.update(
            postgres_port="5432",
            postgres_port_local="5432",
            valkey_port=6379,
            valkey_port_local=6379,
            sentry_environment="dev",
        )
        settings = Settings(_env_file=None, **required)
        self.assertEqual(settings.coverage_sample_retention_hours, 24)
        for name, bad in (
            ("coverage_sample_retention_hours", 0),
            ("coverage_sample_scope_cap", -1),
            ("coverage_sample_max_per_minute", 0),
            ("coverage_sample_max_per_minute", 1001),
        ):
            with self.subTest(name=name), self.assertRaises(ValidationError):
                Settings(_env_file=None, **required, **{name: bad})


class SinkTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tick = 0.0
        self.transaction = MagicMock()
        self.session = AsyncMock()
        self.transaction.__aenter__ = AsyncMock(return_value=self.session)
        self.transaction.__aexit__ = AsyncMock(return_value=False)
        self.sessions = MagicMock()
        self.sessions.begin.return_value = self.transaction
        self.factory = patch("coverage_comparator.postgres_samples.async_sessionmaker", return_value=self.sessions)
        self.factory.start()
        self.addCleanup(self.factory.stop)
        self.insert = AsyncMock(return_value=1)
        self.helper = patch("coverage_comparator.postgres_samples.insert_coverage_samples", self.insert)
        self.helper.start()
        self.addCleanup(self.helper.stop)
        self.sink = self.make_sink()

    def make_sink(self):
        return PostgresSampleSink(
            MagicMock(),
            max_per_minute=2,
            max_samples=7,
            retention_hours=24,
            clock=lambda: self.tick,
            utcnow=lambda: NOW,
        )

    async def test_pacing_scope_isolation_and_reset(self):
        await self.sink.put("id", SAMPLE)
        self.insert.assert_not_awaited()
        self.tick = 30
        await self.sink.put("id", SAMPLE)
        for _ in range(100):
            await self.sink.put("storm", SAMPLE)
        self.assertEqual(self.insert.await_count, 1)
        await self.sink.put("other-direction", {**SAMPLE, "result": "service_only"})
        await self.sink.put("other-service", {**SAMPLE, "service": "dxheat"})
        self.assertEqual(self.insert.await_count, 3)
        reset = self.make_sink()
        await reset.put("restart", SAMPLE)
        self.assertEqual(self.insert.await_count, 3)
        self.tick = 60
        await reset.put("restart", SAMPLE)
        self.assertEqual(self.insert.await_count, 4)
        self.tick = 600
        await reset.put("delayed", SAMPLE)
        await reset.put("no-burst", SAMPLE)
        self.assertEqual(self.insert.await_count, 5)

    async def test_helper_arguments_and_transaction_commit(self):
        self.tick = 30
        await self.sink.put("id", SAMPLE)
        args, kwargs = self.insert.call_args
        self.assertIs(args[0], self.session)
        self.assertEqual(args[1][0].model_dump(), sample_row("id", SAMPLE).model_dump())
        self.assertEqual(
            kwargs,
            dict(
                service="dxsummit",
                direction="holy_only",
                retention_cutoff=NOW - timedelta(hours=24),
                max_samples=7,
            ),
        )
        self.transaction.__aexit__.assert_awaited_once_with(None, None, None)

    async def test_retries_use_shared_idempotent_helper(self):
        self.insert.side_effect = [1, 0]
        self.tick = 30
        await self.sink.put("id", SAMPLE)
        self.tick = 60
        await self.sink.put("id", SAMPLE)
        first, second = self.insert.call_args_list
        self.assertEqual(first.args[1][0].model_dump(), second.args[1][0].model_dump())

    async def test_rollback_on_database_error(self):
        self.tick = 30
        self.insert.side_effect = RuntimeError("database unavailable")
        with self.assertRaisesRegex(RuntimeError, "database unavailable"):
            await self.sink.put("id", SAMPLE)
        self.assertIs(self.transaction.__aexit__.call_args.args[0], RuntimeError)
        await self.sink.put("retry", SAMPLE)
        self.assertEqual(self.insert.await_count, 1)

    async def test_bad_and_expired_samples_do_not_write(self):
        self.tick = 30
        await self.sink.put("bad", {**SAMPLE, "spot": {**SAMPLE["spot"], "time": "2500Z"}})
        await self.sink.put("expired", {**SAMPLE, "finalized": (NOW - timedelta(hours=25)).timestamp()})
        self.sessions.begin.assert_not_called()
        await self.sink.put("valid", SAMPLE)
        self.insert.assert_awaited_once()

    async def test_diagnostics_are_bounded(self):
        with patch("coverage_comparator.postgres_samples.logger") as log:
            for _ in range(100):
                await self.sink.put("id", SAMPLE)
            log.warning.assert_called_once()
            self.tick = 60
            await self.sink.put("bad", {})
            self.assertEqual(log.warning.call_count, 2)


@unittest.skipUnless(
    os.environ.get("COVERAGE_TEST_DATABASE_URL"), "Set COVERAGE_TEST_DATABASE_URL for PostgreSQL tests"
)
class PostgresIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_sink_deduplicates_and_prunes_in_postgres(self):
        url = os.environ["COVERAGE_TEST_DATABASE_URL"]
        schema = f"coverage_sink_test_{uuid4().hex}"
        admin = create_async_engine(url)
        engine = None
        try:
            async with admin.begin() as connection:
                await connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            engine = create_async_engine(
                url, isolation_level="READ COMMITTED", connect_args={"server_settings": {"search_path": schema}}
            )
            async with engine.begin() as connection:
                await connection.run_sync(SpotCoverageSample.__table__.create)
            sessions = async_sessionmaker(engine)
            expired = sample_row("expired", {**SAMPLE, "finalized": (NOW - timedelta(days=2)).timestamp()})
            async with sessions.begin() as session:
                session.add(expired)
            tick = 0
            sink = PostgresSampleSink(engine, max_samples=2, max_per_minute=2, clock=lambda: tick, utcnow=lambda: NOW)
            tick = 30
            await sink.put("first", SAMPLE)
            tick = 60
            await sink.put("first", {**SAMPLE, "finalized": NOW.timestamp() + 10})
            async with sessions() as session:
                rows = (await session.execute(select(SpotCoverageSample))).scalars().all()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].finalized_at, NOW)
            self.assertEqual(rows[0].identity_digest, sample_row("first", SAMPLE).identity_digest)
            for index in (2, 3):
                tick += 30
                await sink.put(str(index), {**SAMPLE, "finalized": NOW.timestamp() + index})
            async with sessions() as session:
                rows = (await session.execute(select(SpotCoverageSample))).scalars().all()
            self.assertEqual(len(rows), 2)
            self.assertEqual(
                {row.identity_digest for row in rows},
                {sample_row(str(index), SAMPLE).identity_digest for index in (2, 3)},
            )
        finally:
            if engine is not None:
                await engine.dispose()
            async with admin.begin() as connection:
                await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            await admin.dispose()
