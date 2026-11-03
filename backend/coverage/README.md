# Coverage sample storage

The command uses PostgreSQL for mismatch examples. It uses the PostgreSQL
settings from `shared.settings.PostgresSettings`. Each write uses one
READ COMMITTED transaction. The shared helper prevents duplicate rows and
applies the retention limit and row cap in that transaction.

| Setting | Default | Valid range |
| --- | --- | --- |
| `COVERAGE_SAMPLE_RETENTION_HOURS` | 24 | 1–8760 |
| `COVERAGE_SAMPLE_SCOPE_CAP` | 1000 | 0–10000 |
| `COVERAGE_SAMPLE_MAX_PER_MINUTE` | 10 | 1–1000 |

A scope is one service and one direction (`holy_only` or `service_only`).
The row cap and write rate apply to each scope. A zero row cap keeps no rows.
Retention uses the finalization time. The helper removes old and excess rows
when a write occurs in that scope. There is no periodic cleanup task.

The sink permits one write attempt per `60 / rate` seconds. It has no burst
credit. Each scope must wait for one full interval after startup. A restart
cannot refill the quota. Failed writes also consume an interval. Database
errors propagate to the caller; a retry within the interval can be skipped.
The write limit affects examples only. Outcome metrics still count all results.
Skipped examples leave the pending sample queue. A warning reports skips at
most once per minute across all scopes. It contains no spot data.

Source time must be `HHMM` or `HHMMZ`. Invalid times cause the example to be
skipped. Observation time uses `observed_at` metadata (an aware datetime or ISO
string), then `timestamp` metadata (epoch seconds), then the window start.
All stored timestamps use UTC. The digest uses the stable sample ID, not the
finalization time. The sink preserves callsigns, frequency, and comment text.
The matcher limits the source sample size before the sink receives it.

`run()` requires an explicit sink when coverage is enabled. Tests can pass
`DisabledSampleSink` or `MemorySampleSink`. `run_with_database()` creates the
real sink and disposes of the engine after shutdown. Disabled coverage does
not create an engine.

## Tests

Run these commands from `backend`:

```sh
uv run pytest coverage/tests
uv run ruff check .
uv run ruff format --check .
uv lock --check
```

Set `COVERAGE_TEST_DATABASE_URL` to an asyncpg SQLAlchemy URL to enable the
PostgreSQL test. Use a test database where the test user can create schemas.
The test creates a unique schema and removes it after the test.
