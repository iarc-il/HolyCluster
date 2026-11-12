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

vi.mock("@/utils/user_id.js", () => ({
    get_user_id: () => "123e4567-e89b-42d3-a456-426614174000",
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

function receive(view, message) {
    act(() => {
        websocket_mock.connection_for("/ws").lastJsonMessage = message;
        view.rerender(
            <WsProvider>
                <TestConsumer messages={view.messages} />
            </WsProvider>,
        );
    });
}

function open(view) {
    const connection = websocket_mock.connection_for("/ws");
    connection.readyState = websocket_mock.ReadyState.OPEN;
    act(() => connection.options.onOpen({ target: { send: vi.fn() } }));
    receive(view, null);
    return connection;
}

const spot_identity = {
    software_id: "HolyCluster",
    ui_version: null,
    catserver_version: null,
    client_type: "desktop",
    browser_type: "other",
    user_id: "123e4567-e89b-42d3-a456-426614174000",
};

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

    it("uses the unified WebSocket exclusively", () => {
        render_provider();

        expect(TestConsumer.context.transport).toBe("unified");
        expect(websocket_mock.connection_for("/ws").connect).toBe(true);
        expect(websocket_mock.connections.has("/radio")).toBe(false);
        expect(websocket_mock.connections.has("/submit_spot")).toBe(false);
    });

    it("uses current readiness from a captured sender", async () => {
        const view = render_provider();
        const captured_send = TestConsumer.context.send;
        const opening = TestConsumer.context.wait_for_open();

        expect(captured_send("history", { event: "spots" })).toBe(false);
        const connection = open(view);
        await opening;

        expect(captured_send("history", { event: "spots" })).toBe(true);
        expect(connection.sendJsonMessage).toHaveBeenCalledWith({
            version: 1,
            type: "history",
            event: "spots",
        });

        connection.readyState = websocket_mock.ReadyState.CLOSED;
        receive(view, null);
        expect(captured_send("history", { event: "spots" })).toBe(false);
    });

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
                receive(view, { version: 1, type: "radio", event: "status", secret: "payload" }),
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

    it("delivers the update handoff before an immediate close", () => {
        const view = render_provider();
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
        receive(view, handoff);

        expect(view.messages.filter(message => message.type === "update")).toEqual([handoff]);
    });

    it("sends the capability request through the guarded hook sender", () => {
        const view = render_provider();
        const connection = websocket_mock.connection_for("/ws");
        const raw_send = vi.fn(() => {
            throw new Error("raw socket send");
        });
        connection.readyState = websocket_mock.ReadyState.OPEN;

        expect(() =>
            act(() => connection.options.onOpen({ target: { send: raw_send } })),
        ).not.toThrow();
        receive(view, null);

        expect(raw_send).not.toHaveBeenCalled();
        expect(connection.sendJsonMessage).toHaveBeenCalledWith(
            { version: 1, type: "radio", action: "GetCapabilities" },
            false,
        );
    });

    it("synchronizes the session clock from spot messages", () => {
        vi.useFakeTimers({ now: 8_000_000 });
        const monotonic_now = vi.spyOn(performance, "now").mockReturnValue(100);
        const view = render_provider();
        open(view);

        receive(view, {
            version: 1,
            type: "spots",
            event: "initial",
            server_time: 2_000,
            spots: [],
        });

        expect(TestConsumer.context.is_server_time).toBe(true);
        expect(TestConsumer.context.now_ms()).toBe(2_000_000);
        monotonic_now.mockReturnValue(600);
        expect(TestConsumer.context.now_ms()).toBe(2_000_500);
    });

    it("scopes spot epochs to unified socket opens", () => {
        const view = render_provider();
        const connection = open(view);
        const first = TestConsumer.context.spot_socket_epoch;
        const send_now = TestConsumer.context.send_now;

        expect(first).toBeGreaterThan(0);
        expect(send_now("spots", { action: "initial" }, first)).toBe(true);
        expect(connection.sendJsonMessage).toHaveBeenLastCalledWith(
            { version: 1, type: "spots", action: "initial", ...spot_identity },
            false,
        );

        act(() => connection.options.onOpen({ target: { send: vi.fn() } }));
        const second = TestConsumer.context.spot_socket_epoch;
        expect(second).toBeGreaterThan(first);
        expect(send_now("spots", {}, first)).toBe(false);
        expect(send_now("spots", {}, second)).toBe(true);
        act(() => connection.options.onClose());
        expect(send_now("spots", {}, second)).toBe(false);
    });

    it("reports UI and CAT versions only on spot messages", () => {
        vi.stubEnv("VITE_UI_VERSION", "v1.2.3");
        const view = render_provider();
        const connection = open(view);
        receive(view, {
            version: 1,
            type: "radio",
            event: "status",
            status: "connected",
            catserver_version: "catserver-v1.3.0",
        });
        const request = Object.freeze({ action: "initial", bands: [20], source: "test" });
        const expected_identity = {
            ...spot_identity,
            ui_version: "v1.2.3",
            catserver_version: "catserver-v1.3.0",
        };

        expect(TestConsumer.context.send("spots", request)).toBe(true);
        expect(connection.sendJsonMessage).toHaveBeenLastCalledWith({
            version: 1,
            type: "spots",
            ...request,
            ...expected_identity,
        });
        expect(TestConsumer.context.send("history", request)).toBe(true);
        expect(connection.sendJsonMessage).toHaveBeenLastCalledWith({
            version: 1,
            type: "history",
            ...request,
        });
        expect(request).toEqual({ action: "initial", bands: [20], source: "test" });
    });

    it("clears CAT identity when the unified connection closes", () => {
        const view = render_provider();
        const connection = open(view);
        receive(view, {
            version: 1,
            type: "radio",
            event: "status",
            catserver_version: "catserver-v1.3.0",
        });

        act(() => connection.options.onClose());
        connection.readyState = websocket_mock.ReadyState.OPEN;
        act(() => connection.options.onOpen({ target: { send: vi.fn() } }));
        receive(view, null);
        TestConsumer.context.send("spots", {});

        expect(connection.sendJsonMessage).toHaveBeenLastCalledWith({
            version: 1,
            type: "spots",
            ...spot_identity,
        });
    });
});
