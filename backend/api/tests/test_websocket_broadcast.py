import asyncio
import unittest
import weakref
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import WebSocket, WebSocketDisconnect

from api import main


class FakeWebSocket:
    def __init__(self, failure=None, *, hang_send=False, hang_close=False):
        self.failure = failure
        self.hang_send = hang_send
        self.hang_close = hang_close
        self.messages = []
        self.close_calls = 0
        self.send_cancelled = False
        self.close_cancelled = False

    async def send_json(self, message):
        if self.failure:
            raise self.failure
        if self.hang_send:
            try:
                await asyncio.Event().wait()
            finally:
                self.send_cancelled = True
        self.messages.append(message)

    async def close(self):
        self.close_calls += 1
        if self.hang_close:
            try:
                await asyncio.Event().wait()
            finally:
                self.close_cancelled = True


class OrderedRecipients(set):
    """Visit a failed recipient first, so skipping later recipients is visible."""

    def __init__(self, first, second):
        super().__init__((first, second))
        self.order = [first, second]

    def copy(self):
        return [recipient for recipient in self.order if recipient in self]


class WebSocketBroadcastTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.locks = weakref.WeakKeyDictionary()
        self.closed = weakref.WeakSet()
        for name, value in (
            ("websocket_send_locks", self.locks),
            ("closed_websockets", self.closed),
            ("websocket_close_tasks", set()),
            ("active_connections", set()),
        ):
            patcher = patch.object(main.app.state, name, value, create=True)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(main, "BROADCAST_WEBSOCKET_TIMEOUT", 0.01)
        patcher.start()
        self.addCleanup(patcher.stop)

    async def asyncTearDown(self):
        await main.cancel_websocket_close_tasks()

    async def assert_failed_recipient_removed(self, failed, *, held_lock=False):
        healthy = FakeWebSocket()
        recipients = OrderedRecipients(failed, healthy)
        lock = main.get_websocket_send_lock(failed)
        if held_lock:
            await lock.acquire()
        try:
            await asyncio.wait_for(main.send_json_to_websockets(recipients, {"test": True}), 1)
            self.assertEqual(healthy.messages, [{"test": True}])
            self.assertEqual(recipients, {healthy})
            self.assertNotIn(failed, self.locks)
            self.assertIn(failed, self.closed)
            self.assertEqual(failed.close_calls, 1)
            # A task that retained the old lock must not send after eviction.
            if held_lock:
                lock.release()
            with self.assertRaises(WebSocketDisconnect):
                await main.send_ws_json(failed, lock, {"late": True})
        finally:
            if held_lock and lock.locked():
                lock.release()

    async def test_disconnect_and_send_error_do_not_skip_healthy_recipient(self):
        for failure in (WebSocketDisconnect(), RuntimeError("send failed")):
            with self.subTest(failure=type(failure).__name__):
                await self.assert_failed_recipient_removed(FakeWebSocket(failure))

    async def test_held_lock_is_bounded_and_recipient_is_closed(self):
        await self.assert_failed_recipient_removed(FakeWebSocket(), held_lock=True)

    async def test_hung_send_and_close_are_bounded(self):
        failed = FakeWebSocket(hang_send=True, hang_close=True)
        await self.assert_failed_recipient_removed(failed)
        self.assertTrue(failed.send_cancelled)
        self.assertFalse(failed.close_cancelled)
        self.assertEqual(len(main.get_websocket_close_tasks()), 1)
        await main.cancel_websocket_close_tasks()
        self.assertTrue(failed.close_cancelled)
        self.assertFalse(main.get_websocket_close_tasks())

    async def test_close_failure_does_not_skip_healthy_recipient(self):
        class CloseFailureWebSocket(FakeWebSocket):
            async def close(self):
                self.close_calls += 1
                raise RuntimeError("close failed")

        await self.assert_failed_recipient_removed(CloseFailureWebSocket(WebSocketDisconnect()))

    async def test_broadcast_continues_for_legacy_and_unified_clients(self):
        legacy_failed = FakeWebSocket(WebSocketDisconnect())
        unified_failed = FakeWebSocket(RuntimeError("send failed"))
        legacy_healthy = FakeWebSocket()
        unified_healthy = FakeWebSocket()
        legacy = OrderedRecipients(legacy_failed, legacy_healthy)
        unified = OrderedRecipients(unified_failed, unified_healthy)
        fake_app = SimpleNamespace(
            state=SimpleNamespace(
                active_connections=legacy,
                active_ws_spot_connections=unified,
            )
        )
        spots = [{"dx_callsign": "K1ABC"}]
        await main.broadcast_spots(fake_app, spots)
        self.assertEqual(legacy_healthy.messages, [{"type": "update", "spots": spots}])
        self.assertEqual(
            unified_healthy.messages,
            [
                {
                    "version": 1,
                    "type": "spots",
                    "event": "update",
                    "spots": spots,
                }
            ],
        )
        self.assertEqual(legacy, {legacy_healthy})
        self.assertEqual(unified, {unified_healthy})
        for failed in (legacy_failed, unified_failed):
            self.assertIn(failed, self.closed)
            self.assertNotIn(failed, self.locks)

    async def test_failed_recipient_does_not_strand_stream_batch(self):
        failed = FakeWebSocket(WebSocketDisconnect())
        healthy = FakeWebSocket()
        fake_app = SimpleNamespace(
            state=SimpleNamespace(
                active_connections=OrderedRecipients(failed, healthy),
                active_ws_spot_connections=set(),
            )
        )
        spot = {"dx_callsign": "K1ABC"}
        client = AsyncMock()
        client.xreadgroup.side_effect = [
            [("stream-api", [("1-0", spot)])],
            asyncio.CancelledError(),
        ]
        with (
            patch.object(main.redis.asyncio, "Redis", return_value=client),
            patch.object(main, "cleanup_spot", side_effect=lambda value: value),
        ):
            with self.assertRaises(asyncio.CancelledError):
                await main.spots_broadcast_task(fake_app)
        self.assertEqual(healthy.messages, [{"type": "update", "spots": [spot]}])
        client.xack.assert_awaited_once_with("stream-api", "api-group", "1-0")
        client.xdel.assert_awaited_once_with("stream-api", "1-0")
        client.aclose.assert_awaited_once()

    async def test_delayed_asgi_close_completes_and_endpoint_cleans_up(self):
        incoming = asyncio.Queue()
        await incoming.put({"type": "websocket.connect"})
        await incoming.put({"type": "websocket.receive", "text": "{}"})
        subscribed = asyncio.Event()
        release_close = asyncio.Event()
        close_completed = asyncio.Event()

        async def send(message):
            if message["type"] == "websocket.close":
                await release_close.wait()
                close_completed.set()
                await incoming.put({"type": "websocket.disconnect", "code": 1000})

        async def initial_spots(*_args):
            subscribed.set()

        websocket = WebSocket({"type": "websocket"}, incoming.get, send)
        endpoint = None
        lock = None
        try:
            with patch.object(main, "send_spots", side_effect=initial_spots):
                endpoint = asyncio.create_task(main.spots_ws(websocket))
                await asyncio.wait_for(subscribed.wait(), 1)
                lock = main.get_websocket_send_lock(websocket)
                await lock.acquire()
                healthy = FakeWebSocket()
                main.app.state.active_connections.add(healthy)
                await asyncio.wait_for(
                    main.broadcast_spots(
                        SimpleNamespace(
                            state=SimpleNamespace(
                                active_connections=main.app.state.active_connections,
                                active_ws_spot_connections=set(),
                            )
                        ),
                        [],
                    ),
                    1,
                )
                self.assertEqual(healthy.messages, [{"type": "update", "spots": []}])
                self.assertFalse(close_completed.is_set())
                self.assertFalse(endpoint.done())
                self.assertEqual(len(main.get_websocket_close_tasks()), 1)
                close_tasks = list(main.get_websocket_close_tasks())
                release_close.set()
                await asyncio.wait_for(asyncio.gather(endpoint, *close_tasks), 1)
                self.assertTrue(close_completed.is_set())
                self.assertFalse(main.get_websocket_close_tasks())
                self.assertNotIn(websocket, main.app.state.active_connections)
                self.assertNotIn(websocket, self.locks)
        finally:
            release_close.set()
            if lock is not None and lock.locked():
                lock.release()
            if endpoint is not None and not endpoint.done():
                endpoint.cancel()
                await asyncio.gather(endpoint, return_exceptions=True)

    async def test_lifespan_cancels_pending_close_tasks(self):
        failed = FakeWebSocket(WebSocketDisconnect(), hang_close=True)
        with (
            patch.object(main, "ensure_cty_available", new_callable=AsyncMock),
            patch.object(main, "propagation_data_collector", new_callable=AsyncMock),
            patch.object(main, "spots_broadcast_task", new_callable=AsyncMock),
            patch.object(main.redis.asyncio, "Redis", return_value=AsyncMock()),
            patch.object(main.httpx, "AsyncClient", return_value=AsyncMock()),
            patch.object(main, "engine", AsyncMock()),
        ):
            async with main.lifespan(main.app):
                await main.send_json_to_websockets({failed}, {})
                self.assertFalse(failed.close_cancelled)
                self.assertEqual(len(main.get_websocket_close_tasks()), 1)
            self.assertTrue(failed.close_cancelled)
            self.assertFalse(main.get_websocket_close_tasks())

    async def test_actual_closed_starlette_websocket_is_removed(self):
        async def receive():
            return {"type": "websocket.connect"}

        async def send(_message):
            pass

        closed = WebSocket({"type": "websocket"}, receive, send)
        await closed.accept()
        await closed.close()
        healthy = FakeWebSocket()
        recipients = OrderedRecipients(closed, healthy)
        await main.send_json_to_websockets(recipients, {"test": True})
        self.assertEqual(recipients, {healthy})
        self.assertEqual(healthy.messages, [{"test": True}])
        self.assertIn(closed, self.closed)
        self.assertNotIn(closed, self.locks)


if __name__ == "__main__":
    unittest.main()
