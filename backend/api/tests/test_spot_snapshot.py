import asyncio
import unittest
from unittest.mock import patch

from api import main


def spot(timestamp):
    return {
        "timestamp": timestamp,
        "spotter_callsign": "SPOTTER",
        "spotter_lon": "1",
        "spotter_lat": "2",
        "spotter_dxcc_code": 1,
        "spotter_continent": "EU",
        "dx_callsign": f"DX{timestamp}",
        "dx_lon": "3",
        "dx_lat": "4",
        "dx_dxcc_code": 2,
        "dx_continent": "EU",
        "frequency": "14074",
        "band": "20",
        "mode": "FT8",
        "comment": "",
    }


class FakeDatabase:
    def __init__(self, rows):
        self.rows = rows
        self.executions = 0
        self.active = 0
        self.peak_active = 0
        self.statements = []
        self.failures = 0
        self.block = None
        self.entered = asyncio.Event()

    def session(self):
        database = self

        class Session:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def execute(self, statement):
                database.executions += 1
                database.statements.append(statement)
                database.active += 1
                database.peak_active = max(database.peak_active, database.active)
                database.entered.set()
                try:
                    # Yield so all reconnect requests can reach the database.
                    await asyncio.sleep(0)
                    if database.block is not None:
                        await database.block.wait()
                    if database.failures:
                        database.failures -= 1
                        raise RuntimeError("query failed")
                    parameters = statement.compile().params
                    rows = database.rows
                    if "timestamp_1" in parameters:
                        rows = [row for row in rows if row["timestamp"] > parameters["timestamp_1"]]
                    rows = sorted(rows, key=lambda row: row["timestamp"], reverse=True)
                    rows = rows[: parameters["param_1"]]

                    class Result:
                        def scalars(self):
                            return rows

                    return Result()
                finally:
                    database.active -= 1

        return Session()


class SpotSnapshotTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.database = FakeDatabase([spot(10000 - index) for index in range(600)])
        patcher = patch.object(main, "async_session", self.database.session)
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = patch.object(main.time, "time", return_value=10000)
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = patch.object(main.app.state, "spot_snapshot", None, create=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    async def test_reconnect_burst_uses_one_query(self):
        """On original d22154a6 this fails with executions=30, peak_active=30."""
        results = await asyncio.gather(
            *(main.get_initial_spots() if index % 2 else main.get_spots_after(9800) for index in range(30))
        )
        self.assertEqual([len(result) for result in results], [200, 500] * 15)
        self.assertEqual(
            (self.database.executions, self.database.peak_active),
            (1, 1),
            "reconnect burst must share a query rather than occupy the connection pool",
        )

    async def test_thresholds_match_original_filter_then_limit(self):
        for threshold in (0, 9400, 9500, 9501, 9800, 9800.5, 9999, 10000, 10001):
            with self.subTest(threshold=threshold):
                expected = main.cleanup_spots(
                    sorted(
                        (row for row in self.database.rows if row["timestamp"] > threshold),
                        key=lambda row: row["timestamp"],
                        reverse=True,
                    )[:500]
                )
                self.assertEqual(await main.get_spots_after(threshold), expected)
        self.assertEqual(self.database.executions, 1)
        statement = self.database.statements[0]
        self.assertNotIn("WHERE", str(statement))
        self.assertIn("ORDER BY holy_spots2.timestamp DESC", str(statement))
        self.assertEqual(statement.compile().params, {"param_1": 500})

    async def test_initial_one_hour_boundary_is_recomputed(self):
        self.database.rows = [spot(value) for value in (10001, 10000, 6401, 6400, 6399)]
        first = await main.get_initial_spots()
        self.assertEqual([row["time"] for row in first], [10001, 10000, 6401])
        with patch.object(main.time, "time", return_value=10001):
            second = await main.get_initial_spots()
        self.assertEqual([row["time"] for row in second], [10001, 10000])
        self.assertEqual(self.database.executions, 1)

    async def test_ttl_refresh_is_shared_and_uses_monotonic_time(self):
        with patch.object(main.time, "monotonic", return_value=100):
            first = await main.get_spots_after(0)
        self.database.rows.insert(0, spot(10001))
        with patch.object(main.time, "monotonic", return_value=100.9):
            self.assertEqual(await main.get_spots_after(0), first)
        with patch.object(main.time, "monotonic", return_value=101):
            results = await asyncio.gather(*(main.get_spots_after(0) for _ in range(30)))
        self.assertEqual(self.database.executions, 2)
        self.assertEqual(self.database.peak_active, 1)
        self.assertTrue(all(result[0]["time"] == 10001 for result in results))
        self.assertTrue(all(len(result) == 500 for result in results))

    async def test_query_failure_does_not_poison_cache(self):
        self.database.failures = 1
        with self.assertRaisesRegex(RuntimeError, "query failed"):
            await main.get_spots_after(0)
        results = await asyncio.gather(*(main.get_spots_after(0) for _ in range(30)))
        self.assertEqual(self.database.executions, 2)
        self.assertTrue(all(len(result) == 500 for result in results))

    async def test_empty_snapshot_is_cached(self):
        self.database.rows = []
        self.assertEqual(await main.get_initial_spots(), [])
        self.assertEqual(await main.get_spots_after(0), [])
        self.assertEqual(self.database.executions, 1)

    async def test_results_do_not_share_lists_dicts_or_locations(self):
        first = await main.get_spots_after(0)
        second = await main.get_spots_after(0)
        first[0]["dx_callsign"] = "CHANGED"
        first[0]["dx_loc"][0] = 999
        first.pop()
        third = await main.get_spots_after(0)
        self.assertEqual(second, third)
        self.assertEqual(len(third), 500)
        self.assertEqual(third[0]["dx_loc"], [3, 4])
        self.assertEqual(third[0]["dx_callsign"], "DX10000")
        self.assertIsNot(second, third)
        self.assertIsNot(second[0], third[0])

    async def test_cancelled_query_releases_lock_for_retry(self):
        self.database.block = asyncio.Event()
        task = asyncio.create_task(main.get_spots_after(0))
        await self.database.entered.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.database.block.set()
        result = await asyncio.wait_for(main.get_spots_after(0), timeout=1)
        self.assertEqual(len(result), 500)
        self.assertEqual(self.database.executions, 2)
        self.assertEqual(self.database.active, 0)

    async def test_cancelled_waiter_does_not_cancel_query(self):
        self.database.block = asyncio.Event()
        owner = asyncio.create_task(main.get_spots_after(0))
        await self.database.entered.wait()
        waiter = asyncio.create_task(main.get_spots_after(0))
        await asyncio.sleep(0)
        waiter.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await waiter
        self.database.block.set()
        self.assertEqual(len(await owner), 500)
        self.assertEqual(len(await main.get_spots_after(0)), 500)
        self.assertEqual(self.database.executions, 1)


if __name__ == "__main__":
    unittest.main()
