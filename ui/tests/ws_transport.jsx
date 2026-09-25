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

function TestConsumer({ messages }) {
    const context = useWs();
    useWsMessage("radio", message => messages.push(message));
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
