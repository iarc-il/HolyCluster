import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const websocket_mock = vi.hoisted(() => {
    const ReadyState = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, UNINSTANTIATED: -1 };
    const connections = new Map();

    function connection_for(url) {
        const path = url.startsWith("/") ? url : new URL(url).pathname;
        if (!connections.has(path)) {
            connections.set(path, {
                lastJsonMessage: null,
                readyState: ReadyState.CONNECTING,
                sendJsonMessage: vi.fn(),
                options: null,
                connect: false,
            });
        }
        return connections.get(path);
    }

    return {
        ReadyState,
        connections,
        connection_for,
        useWebSocket: vi.fn((url, options, connect) => {
            const connection = connection_for(url);
            connection.options = options;
            connection.connect = connect;
            return connection;
        }),
    };
});

vi.mock("react-use-websocket", () => ({
    default: websocket_mock.useWebSocket,
    ReadyState: websocket_mock.ReadyState,
}));

import { WsProvider, useWs, useWsMessage } from "@/hooks/useWs";
import { prepareSentryEvent } from "@/sentry";

function TestConsumer({ messages }) {
    const context = useWs();
    useWsMessage("radio", message => messages.push(message));
    useWsMessage("update", message => messages.push(message));
    TestConsumer.context = context;
    return null;
}

function render_provider(messages = []) {
    const view = render(
        <WsProvider>
            <TestConsumer messages={messages} />
        </WsProvider>,
    );
    return { ...view, messages };
}

function receive(view, path, message) {
    act(() => {
        websocket_mock.connection_for(path).lastJsonMessage = message;
        view.rerender(
            <WsProvider>
                <TestConsumer messages={view.messages} />
            </WsProvider>,
        );
    });
}

describe("WebSocket transport", () => {
    beforeEach(() => {
        websocket_mock.connections.clear();
        websocket_mock.useWebSocket.mockClear();
        TestConsumer.context = null;
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });

    it.each(["unified", "legacy"])(
        "uses current %s readiness from a send captured while probing",
        async candidate => {
            const view = render_provider();
            const captured_send = TestConsumer.context.send;
            const open = TestConsumer.context.wait_for_open();
            captured_send("history", { event: "spots" });
            const path = candidate === "unified" ? "/ws" : "/submit_spot";
            const connection = websocket_mock.connection_for(path);
            connection.readyState = websocket_mock.ReadyState.OPEN;
            if (candidate === "unified") receive(view, "/radio", { status: "unavailable" });
            else receive(view, "/radio", { status: "connected", version: "catserver-v1.2.0" });
            await open;
            captured_send("history", { event: "spots" });
            expect(connection.sendJsonMessage).toHaveBeenCalledWith({
                version: 1,
                type: "history",
                event: "spots",
            });
            connection.readyState = websocket_mock.ReadyState.CLOSED;
            receive(view, path, null);
            expect(captured_send("history", { event: "spots" })).toBe(false);
            expect(connection.sendJsonMessage).toHaveBeenCalledTimes(
                candidate === "unified" ? 2 : 1,
            );
        },
    );

    it.each(["abort", "timeout", "unmount"])("settles an opening waiter on %s", async reason => {
        vi.useFakeTimers();
        const view = render_provider();
        const controller = new AbortController();
        const pending = TestConsumer.context.wait_for_open(controller.signal);
        const rejection = expect(pending).rejects.toThrow(
            reason === "timeout" ? "timed out" : "Aborted",
        );
        if (reason === "abort") controller.abort();
        else if (reason === "unmount") view.unmount();
        else await vi.advanceTimersByTimeAsync(10_000);
        await rejection;
        if (reason !== "unmount") view.unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("annotates a subscriber failure without replacing or suppressing it", () => {
        const view = render_provider();
        const error = new TypeError("private secret message");
        const unsubscribe = TestConsumer.context.subscribe("radio", () => {
            throw error;
        });
        const console_error = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            expect(() =>
                receive(view, "/radio", { status: "unavailable", secret: "payload" }),
            ).toThrow(error);
            const event = prepareSentryEvent(
                { exception: { values: [{ type: "TypeError", value: error.message }] } },
                { originalException: error },
            );
            expect(event.contexts.diagnostic).toMatchObject({
                operation: "websocket_message",
                stage: "subscriber",
                message_type: "radio",
                transport: "unified",
            });
            expect(JSON.stringify(event)).toContain("private secret message");
        } finally {
            unsubscribe();
            console_error.mockRestore();
        }
    });

    it("delivers the update handoff before an immediate transport close", () => {
        const view = render_provider();
        receive(view, "/ws", {
            type: "radio",
            event: "status",
            catserver_version: "catserver-v1.3.0",
        });
        const connection = websocket_mock.connection_for("/ws");
        const handoff = {
            version: 1,
            type: "update",
            event: "restarting",
            session: { id: "transaction" },
        };
        act(() => {
            connection.options.onMessage?.({ data: JSON.stringify(handoff) });
            connection.options.onClose();
        });
        receive(view, "/ws", handoff);
        expect(view.messages.filter(message => message.type === "update")).toEqual([handoff]);
    });

    it("sends the unified identity probe through the guarded hook sender", () => {
        const view = render_provider();
        const connection = websocket_mock.connection_for("/ws");
        const raw_send = vi.fn(() => {
            throw new Error("raw socket send");
        });
        connection.readyState = websocket_mock.ReadyState.OPEN;

        expect(() =>
            act(() => connection.options.onOpen({ target: { send: raw_send } })),
        ).not.toThrow();

        expect(raw_send).not.toHaveBeenCalled();
        expect(connection.sendJsonMessage).toHaveBeenCalledWith(
            { version: 1, type: "radio", action: "GetCapabilities" },
            false,
        );
        view.unmount();
    });

    it("selects unified transport for the direct backend identity", () => {
        const view = render_provider();
        const unified = websocket_mock.connection_for("/ws");
        const legacy_radio = websocket_mock.connection_for("/radio");
        const legacy_spots = websocket_mock.connection_for("/submit_spot");

        expect(TestConsumer.context.transport).toBe("probing");
        expect(unified.connect).toBe(true);
        expect(legacy_radio.connect).toBe(true);
        expect(legacy_spots.connect).toBe(false);

        unified.readyState = websocket_mock.ReadyState.OPEN;
        receive(view, "/radio", { status: "unavailable" });

        expect(TestConsumer.context.transport).toBe("unified");
        expect(legacy_radio.connect).toBe(false);
        expect(view.messages).toEqual([
            {
                version: 1,
                type: "radio",
                event: "status",
                status: "unavailable",
            },
        ]);

        act(() => TestConsumer.context.send("radio", { action: "GetCapabilities" }));
        expect(unified.sendJsonMessage).toHaveBeenCalledWith({
            version: 1,
            type: "radio",
            action: "GetCapabilities",
        });
    });

    it("selects unified transport for a current CAT identity", () => {
        const view = render_provider();
        const unified = websocket_mock.connection_for("/ws");
        const legacy_radio = websocket_mock.connection_for("/radio");

        unified.readyState = websocket_mock.ReadyState.OPEN;
        receive(view, "/ws", {
            version: 1,
            type: "radio",
            event: "status",
            status: "connected",
            catserver_version: "catserver-v1.2.0-1848-gabcdef",
        });

        expect(TestConsumer.context.transport).toBe("unified");
        expect(legacy_radio.connect).toBe(false);
        expect(view.messages).toHaveLength(1);
    });

    it("falls back to unified transport when neither probe identifies itself", () => {
        vi.useFakeTimers();
        const view = render_provider();
        const unified = websocket_mock.connection_for("/ws");
        const legacy_radio = websocket_mock.connection_for("/radio");

        act(() => vi.advanceTimersByTime(1500));

        expect(TestConsumer.context.transport).toBe("unified");
        expect(unified.connect).toBe(true);
        expect(legacy_radio.connect).toBe(false);
        view.unmount();
    });

    it("selects legacy CAT only after receiving its versioned identity", () => {
        const view = render_provider();
        const unified = websocket_mock.connection_for("/ws");
        const legacy_radio = websocket_mock.connection_for("/radio");
        const legacy_spots = websocket_mock.connection_for("/submit_spot");

        legacy_radio.readyState = websocket_mock.ReadyState.OPEN;
        receive(view, "/radio", {
            status: "connected",
            version: "catserver-v1.2.0",
        });

        expect(TestConsumer.context.transport).toBe("cat_v1_2");
        expect(unified.connect).toBe(false);
        expect(legacy_spots.connect).toBe(true);
        expect(view.messages).toEqual([
            {
                version: 1,
                type: "radio",
                event: "status",
                status: "connected",
                catserver_version: "catserver-v1.2.0",
            },
        ]);

        act(() => TestConsumer.context.send("radio", { action: "SetRig", rig: 2 }));
        expect(legacy_radio.sendJsonMessage).toHaveBeenCalledWith({ type: "SetRig", rig: 2 });
    });

    it.each(["unified", "legacy"])("scopes passive epochs to %s spot socket opens", candidate => {
        const view = render_provider();
        const path = candidate === "unified" ? "/ws" : "/submit_spot";
        const connection = websocket_mock.connection_for(path);
        connection.readyState = websocket_mock.ReadyState.OPEN;
        act(() => connection.options.onOpen({ target: { send: vi.fn() } }));
        expect(TestConsumer.context.spot_socket_epoch).toBeNull();
        receive(
            view,
            "/radio",
            candidate === "unified"
                ? { status: "unavailable" }
                : { status: "connected", version: "catserver-v1.2.0" },
        );
        const first = TestConsumer.context.spot_socket_epoch;
        expect(first).toBeGreaterThan(0);
        const send_now = TestConsumer.context.send_now;
        expect(send_now("spots", { action: "initial" }, first)).toBe(true);
        expect(connection.sendJsonMessage).toHaveBeenLastCalledWith(
            {
                version: 1,
                type: "spots",
                action: "initial",
                ui_version: null,
                catserver_version: candidate === "unified" ? null : "catserver-v1.2.0",
            },
            false,
        );
        receive(view, "/radio", { status: "connected", version: "catserver-v1.2.0" });
        expect(TestConsumer.context.spot_socket_epoch).toBe(first);
        act(() => connection.options.onOpen({ target: { send: vi.fn() } }));
        const second = TestConsumer.context.spot_socket_epoch;
        expect(second).toBeGreaterThan(first);
        expect(send_now("spots", {}, first)).toBe(false);
        expect(send_now("spots", {}, second)).toBe(true);
        expect(
            websocket_mock.useWebSocket.mock.calls.every(([url]) => !url.includes("resume=")),
        ).toBe(true);
        act(() => connection.options.onClose());
        expect(send_now("spots", {}, second)).toBe(false);
    });

    it.each(["unified", "legacy"])("reports versions only on %s spots at send time", candidate => {
        vi.stubEnv("VITE_SENTRY_RELEASE", "holy-ui@abc123");
        const view = render_provider();
        const path = candidate === "unified" ? "/ws" : "/submit_spot";
        const connection = websocket_mock.connection_for(path);
        connection.readyState = websocket_mock.ReadyState.OPEN;
        act(() => connection.options.onOpen());
        const request = Object.freeze({ action: "initial", bands: [20], source: "test" });
        const send = TestConsumer.context.send;
        const send_now = TestConsumer.context.send_now;
        expect(send("spots", request)).toBe(false);
        receive(
            view,
            candidate === "unified" ? "/ws" : "/radio",
            candidate === "unified"
                ? { version: 1, type: "radio", event: "status", status: "unavailable" }
                : { status: "connected", version: "catserver-v1.2.0" },
        );
        const epoch = TestConsumer.context.spot_socket_epoch;
        const expected = catserver_version => ({
            version: 1,
            type: "spots",
            ...request,
            ui_version: "holy-ui@abc123",
            catserver_version,
        });
        expect(send("spots", request)).toBe(true);
        expect(connection.sendJsonMessage).toHaveBeenLastCalledWith(
            expected(candidate === "unified" ? null : "catserver-v1.2.0"),
        );
        receive(
            view,
            candidate === "unified" ? "/ws" : "/radio",
            candidate === "unified"
                ? { type: "radio", event: "status", catserver_version: "catserver-v1.3.0" }
                : { status: "connected", version: "catserver-v1.2.1" },
        );
        const version = candidate === "unified" ? "catserver-v1.3.0" : "catserver-v1.2.1";
        expect(send("spots", request)).toBe(true);
        expect(connection.sendJsonMessage).toHaveBeenLastCalledWith(expected(version));
        expect(send_now("spots", request, epoch)).toBe(true);
        expect(connection.sendJsonMessage).toHaveBeenLastCalledWith(expected(version), false);
        expect(request).toEqual({ action: "initial", bands: [20], source: "test" });
        for (const type of ["history", "update", "rotator"]) {
            expect(send(type, request)).toBe(true);
            expect(connection.sendJsonMessage).toHaveBeenLastCalledWith({
                version: 1,
                type,
                ...request,
            });
            expect(send_now(type, request, epoch)).toBe(true);
            expect(connection.sendJsonMessage).toHaveBeenLastCalledWith(
                { version: 1, type, ...request },
                false,
            );
        }
        const radio = websocket_mock.connection_for(candidate === "unified" ? "/ws" : "/radio");
        radio.readyState = websocket_mock.ReadyState.OPEN;
        receive(view, path, null);
        expect(send("radio", { action: "GetCapabilities" })).toBe(true);
        expect(radio.sendJsonMessage).toHaveBeenLastCalledWith(
            candidate === "unified"
                ? { version: 1, type: "radio", action: "GetCapabilities" }
                : { type: "GetCapabilities" },
        );
    });

    it.each(["unified", "legacy"])("clears %s identity when its spot socket closes", candidate => {
        vi.useFakeTimers();
        const view = render_provider();
        const path = candidate === "unified" ? "/ws" : "/submit_spot";
        const connection = websocket_mock.connection_for(path);
        connection.readyState = websocket_mock.ReadyState.OPEN;
        receive(
            view,
            candidate === "unified" ? "/ws" : "/radio",
            candidate === "unified"
                ? { type: "radio", event: "status", catserver_version: "catserver-v1.3.0" }
                : { status: "connected", version: "catserver-v1.2.0" },
        );
        act(() => connection.options.onClose());
        act(() => vi.advanceTimersByTime(1500));
        expect(TestConsumer.context.send("spots", {})).toBe(true);
        expect(connection.sendJsonMessage).toHaveBeenLastCalledWith({
            version: 1,
            type: "spots",
            ui_version: null,
            catserver_version: null,
        });
    });

    it("clears a CAT identity when the direct backend identifies itself", () => {
        const view = render_provider();
        const connection = websocket_mock.connection_for("/ws");
        connection.readyState = websocket_mock.ReadyState.OPEN;
        receive(view, "/ws", {
            type: "radio",
            event: "status",
            catserver_version: "catserver-v1.3.0",
        });
        receive(view, "/ws", { version: 1, type: "radio", event: "status", status: "unavailable" });
        TestConsumer.context.send("spots", {});
        expect(connection.sendJsonMessage).toHaveBeenLastCalledWith({
            version: 1,
            type: "spots",
            ui_version: null,
            catserver_version: null,
        });
    });

    it("returns to parallel probing when the selected transport closes", () => {
        const view = render_provider();
        const unified = websocket_mock.connection_for("/ws");
        const legacy_radio = websocket_mock.connection_for("/radio");

        unified.readyState = websocket_mock.ReadyState.OPEN;
        receive(view, "/ws", {
            version: 1,
            type: "radio",
            event: "status",
            status: "connected",
            catserver_version: "catserver-v1.2.1",
        });
        expect(TestConsumer.context.transport).toBe("unified");

        act(() => unified.options.onClose());

        expect(TestConsumer.context.transport).toBe("probing");
        expect(unified.connect).toBe(true);
        expect(legacy_radio.connect).toBe(true);
    });
});
