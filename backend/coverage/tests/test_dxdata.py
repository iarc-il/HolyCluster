import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import aiohttp

from coverage_comparator.feeds.dxdata import DXDataAdapter, normalize_spot, parse_frequency

ROW = {
    "spotter": " w1aa-12 ",
    "dx": "4x1aa/p",
    "frequency": "14.255.0",
    "time": "2026-11-03 22:23Z",
    "comment": " CQ ",
}


class Response:
    def __init__(self, rows):
        self.body = json.dumps(rows).encode()
        self.content = self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    def raise_for_status(self):
        pass

    async def iter_chunked(self, size):
        # Deliberately fragmented HTTP response.
        for start in range(0, len(self.body), 17):
            yield self.body[start : start + 17]


class Socket:
    def __init__(self):
        self.incoming = asyncio.Queue()
        self.closed = False
        self.send_json = AsyncMock()
        self.close = AsyncMock(side_effect=self._close)

    def _close(self):
        self.closed = True

    async def receive(self):
        return await self.incoming.get()

    def send(self, payload, kind=aiohttp.WSMsgType.TEXT):
        self.incoming.put_nowait(SimpleNamespace(type=kind, data=json.dumps(payload)))


class Session:
    def __init__(self):
        self.rows = [ROW]
        self.sockets = []
        self.requests = []
        self.close = AsyncMock()

    async def ws_connect(self, url, **kwargs):
        self.requests.append((url, kwargs))
        socket = Socket()
        self.sockets.append(socket)
        return socket

    def get(self, url, **kwargs):
        self.requests.append((url, kwargs))
        return Response(self.rows)


class ParsingTests(unittest.TestCase):
    def test_frequency(self):
        for value, expected in (
            ("14.255.0", 14255.0),
            ("1.840.5", 1840.5),
            ("14255.0", 14255.0),
            ("50.313.25", 50313.25),
            ("1.296.100.0", 1296100.0),
            (" 7000 ", 7000.0),
        ):
            with self.subTest(value=value):
                self.assertEqual(parse_frequency(value), expected)
        for value in (True, None, 14255, "nan", "inf", "-1", "0", "14.25.0", "1,840.0", "1e3", "14..0"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_frequency(value)

    def test_normalization(self):
        self.assertEqual(
            normalize_spot(ROW),
            {
                "spotter_callsign": "W1AA",
                "dx_callsign": "4X1AA/P",
                "frequency": 14255.0,
                "time": "2223Z",
                "comment": "CQ",
            },
        )
        for field, value in (
            ("time", "2026-02-30 22:23Z"),
            ("time", "22:23Z"),
            ("comment", []),
            ("spotter", ""),
            ("dx", None),
            ("frequency", "14.25.0"),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                normalize_spot({**ROW, field: value})


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.now = 1000.0
        self.session = Session()
        self.adapter = DXDataAdapter(
            session=self.session,
            clock=lambda: self.now,
            http_url="https://example/seed",
            ws_url="wss://example/live",
            origin="https://example",
            queue_limit=3,
            seed_limit=4,
        )

    async def asyncTearDown(self):
        await self.adapter.close()

    async def settle(self):
        # Let the receiver consume all locally queued frames without real time/network.
        await asyncio.sleep(0)
        await asyncio.sleep(0)

    async def start(self):
        snapshot = await self.adapter.poll()
        self.assertFalse(snapshot.recoverable)
        self.assertEqual(snapshot.spots, [])
        self.now += 60
        self.assertTrue((await self.adapter.poll()).recoverable)
        return self.session.sockets[-1]

    async def test_seed_and_request_policy(self):
        await self.start()
        self.assertEqual((await self.adapter.poll()).spots, [])
        ws, http = self.session.requests
        self.assertEqual(ws[0], "wss://example/live")
        self.assertEqual(http[0], "https://example/seed")
        self.assertEqual(http[1]["params"], {"rbn": "false", "psk": "false"})
        for _, kwargs in (ws, http):
            self.assertIn("Firefox/", kwargs["headers"]["User-Agent"])
            self.assertEqual(kwargs["headers"]["Origin"], "https://example")
            self.assertIn("timeout", kwargs)
        self.assertGreater(ws[1]["max_msg_size"], 0)

    async def test_http_snapshot_envelope(self):
        self.session.rows = {"spots": [ROW]}
        await self.start()
        self.assertTrue((await self.adapter.poll()).recoverable)

    async def test_live_order_overlap_and_duplicate(self):
        ws = await self.start()
        ws.send(ROW)  # HTTP/live overlap is never emitted.
        a, b = {**ROW, "dx": "A1AA"}, {**ROW, "dx": "B1AA"}
        ws.send({"type": "spot", "spot": a})
        ws.send(a)
        ws.send({"type": "spots", "spots": [b]})
        await self.settle()
        result = await self.adapter.poll()
        self.assertTrue(result.recoverable)
        self.assertEqual([spot["dx_callsign"] for spot in result.spots], ["A1AA", "B1AA"])
        self.assertEqual((await self.adapter.poll()).spots, [])

    async def test_warmup_does_not_emit_or_replay(self):
        await self.adapter.poll()
        ws = self.session.sockets[-1]
        warmup = {**ROW, "dx": "A1AA"}
        ws.send(warmup)
        await self.settle()
        self.assertFalse((await self.adapter.poll()).recoverable)
        self.now += 60
        ws.send(warmup)
        await self.settle()
        self.assertEqual((await self.adapter.poll()).spots, [])

    async def test_ping_and_control(self):
        ws = await self.start()
        ws.send({"type": "ping"})
        ws.send({"type": "pong"})
        ws.send(None, aiohttp.WSMsgType.PONG)
        await self.settle()
        ws.send_json.assert_awaited_once_with({"type": "pong"})
        self.assertTrue((await self.adapter.poll()).recoverable)
        # Exercise periodic browser-style JSON ping without a 30-second sleep.
        self.adapter._pinger.cancel()
        await asyncio.gather(self.adapter._pinger, return_exceptions=True)

        async def tick(_):
            self.adapter._gap = True

        with patch("coverage_comparator.feeds.dxdata.asyncio.sleep", side_effect=tick):
            await self.adapter._ping()
        self.assertEqual(ws.send_json.call_args.args, ({"type": "ping"},))

    async def test_disconnect_requires_new_seed_and_full_warmup(self):
        ws = await self.start()
        ws.send({**ROW, "dx": "A1AA"})
        ws.send(None, aiohttp.WSMsgType.CLOSED)
        await self.settle()
        self.assertFalse((await self.adapter.poll()).recoverable)
        self.assertTrue(ws.closed)
        self.assertEqual(len(self.session.sockets), 2)
        self.assertFalse((await self.adapter.poll()).recoverable)
        self.now += 59
        self.assertFalse((await self.adapter.poll()).recoverable)
        self.now += 1
        result = await self.adapter.poll()
        self.assertTrue(result.recoverable)
        self.assertEqual(result.spots, [])

    async def test_closed_flag_without_frame(self):
        ws = await self.start()
        ws.closed = True
        self.assertFalse((await self.adapter.poll()).recoverable)
        self.assertFalse((await self.adapter.poll()).recoverable)

    async def test_queue_overflow(self):
        ws = await self.start()
        for dx in ("A1AA", "B1AA", "C1AA", "D1AA"):
            ws.send({**ROW, "dx": dx})
        await self.settle()
        self.assertTrue(self.adapter._saturated)
        self.assertTrue(self.adapter._gap)
        self.assertEqual(len(self.adapter._queue), 0)
        result = await self.adapter.poll()
        self.assertFalse(result.recoverable)
        self.assertTrue(result.saturated)

    async def test_seed_saturation_and_size_limit(self):
        self.session.rows = [ROW] * 4
        result = await self.adapter.poll()
        self.assertTrue(result.saturated)
        self.assertFalse(result.recoverable)
        self.session.rows = [ROW]
        self.adapter._max_bytes = 10
        result = await self.adapter.poll()
        self.assertTrue(result.saturated)
        self.assertFalse(result.recoverable)

    async def test_identity_memory_limit(self):
        ws = await self.start()
        self.adapter._identity_limit = 1
        ws.send({**ROW, "dx": "A1AA"})
        await self.settle()
        self.assertTrue(self.adapter._gap)
        self.assertTrue(self.adapter._saturated)
        self.assertLessEqual(len(self.adapter._seen), 1)

    async def test_malformed_payloads_fail_closed(self):
        for payload in (
            {"type": "pong", "dx": "A1AA"},
            {"type": "unknown"},
            {"dx": "A1AA"},
            None,
            [ROW, {}],
            {"type": "spots", "spots": None},
        ):
            with self.subTest(payload=payload):
                self.now += 60
                await self.adapter.poll()
                if self.adapter._gap:
                    await self.adapter.poll()
                self.now += 60
                await self.adapter.poll()
                self.session.sockets[-1].send(payload)
                await self.settle()
                self.assertTrue(self.adapter._gap)
                self.assertEqual(len(self.adapter._queue), 0)
                self.assertFalse((await self.adapter.poll()).recoverable)

    async def test_bad_json_and_binary(self):
        ws = await self.start()
        ws.incoming.put_nowait(SimpleNamespace(type=aiohttp.WSMsgType.TEXT, data="{"))
        await self.settle()
        self.assertTrue(self.adapter._gap)
        await self.adapter.poll()
        self.session.sockets[-1].send(None, aiohttp.WSMsgType.BINARY)
        await self.settle()
        self.assertTrue(self.adapter._gap)

    async def test_http_failure_and_malformed_seed(self):
        self.session.rows = {"not": "a list"}
        self.assertFalse((await self.adapter.poll()).recoverable)
        self.session.rows = [{}]
        self.assertFalse((await self.adapter.poll()).recoverable)
        with patch.object(self.session, "get", side_effect=aiohttp.ClientError()):
            self.assertFalse((await self.adapter.poll()).recoverable)

    async def test_receive_timeout_and_ping_failure(self):
        ws = await self.start()
        self.adapter._reader.cancel()
        await asyncio.gather(self.adapter._reader, return_exceptions=True)
        with patch.object(ws, "receive", side_effect=asyncio.TimeoutError):
            await self.adapter._receive()
        self.assertTrue(self.adapter._gap)
        self.assertFalse((await self.adapter.poll()).recoverable)
        self.adapter._pinger.cancel()
        await asyncio.gather(self.adapter._pinger, return_exceptions=True)
        with (
            patch("coverage_comparator.feeds.dxdata.asyncio.sleep", new=AsyncMock()),
            patch.object(self.session.sockets[-1], "send_json", side_effect=OSError),
        ):
            await self.adapter._ping()
        self.assertTrue(self.adapter._gap)

    async def test_live_size_and_batch_saturation(self):
        ws = await self.start()
        ws.send([ROW] * 3)
        await self.settle()
        result = await self.adapter.poll()
        self.assertFalse(result.recoverable)
        self.assertTrue(result.saturated)
        self.adapter._max_bytes = 10
        self.session.sockets[-1].send(ROW)
        await self.settle()
        self.assertTrue(self.adapter._gap)

    async def test_identity_expiration_is_bounded(self):
        ws = await self.start()
        self.now += 300
        ws.send({**ROW, "dx": "A1AA"})
        await self.settle()
        self.assertEqual(len(self.adapter._seen), 1)
        self.assertEqual(len((await self.adapter.poll()).spots), 1)

    async def test_close_and_session_ownership(self):
        ws = await self.start()
        await self.adapter.close()
        await self.adapter.close()
        self.assertTrue(ws.closed)
        self.session.close.assert_not_awaited()
        self.assertIsNone(self.adapter._reader)
        self.assertIsNone(self.adapter._pinger)
        self.assertEqual(len(self.adapter._seen), 0)
        self.assertFalse((await self.adapter.poll()).recoverable)
        owned = DXDataAdapter()
        with patch("coverage_comparator.feeds.dxdata.aiohttp.ClientSession", return_value=self.session):
            await owned.poll()
            await owned.close()
        self.session.close.assert_awaited_once()
