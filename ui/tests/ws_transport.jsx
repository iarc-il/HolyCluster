import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const websocket_mock = vi.hoisted(() => {
    const connections = new Map();
    const ReadyState = {
        CONNECTING: 0,
        OPEN: 1,
        CLOSING: 2,
        CLOSED: 3,
        UNINSTANTIATED: -1,
    };

    return {
        ReadyState,
        connections,
        useWebSocket: vi.fn((url, options, connect = true) => {
            let connection = connections.get(url);
            if (!connection) {
                connection = {
                    connect,
                    lastJsonMessage: null,
                    options,
                    readyState: ReadyState.CONNECTING,
                    sendJsonMessage: vi.fn(),
                };
                connections.set(url, connection);
            }
            connection.connect = connect;
            connection.options = options;
            return connection;
        }),
    };
});

vi.mock("react-use-websocket", () => ({
    default: websocket_mock.useWebSocket,
    ReadyState: websocket_mock.ReadyState,
}));

import { WsProvider, useWs, useWsMessage } from "@/hooks/useWs";

function connection_for(path) {
    return [...websocket_mock.connections.entries()].find(([url]) => url.endsWith(path))?.[1];
}

function TestConsumer({ messages }) {
    const context = useWs();
    useWsMessage("spots", message => messages.spots.push(message));
    useWsMessage("submit", message => messages.submit.push(message));
    useWsMessage("radio", message => messages.radio.push(message));
    TestConsumer.context = context;
    return null;
}

function render_provider(messages = { radio: [], spots: [], submit: [] }) {
    const result = render(
        <WsProvider>
            <TestConsumer messages={messages} />
        </WsProvider>,
    );
    return { ...result, messages };
}

describe("WebSocket transport", () => {
    beforeEach(() => {
        websocket_mock.connections.clear();
        websocket_mock.useWebSocket.mockClear();
        TestConsumer.context = null;
    });

    afterEach(() => cleanup());

    it("uses the unified endpoint when its handshake succeeds", () => {
        const { rerender } = render_provider();
        const unified = connection_for("/ws");

        unified.readyState = websocket_mock.ReadyState.OPEN;
        act(() => unified.options.onOpen());
        rerender(
            <WsProvider>
                <TestConsumer messages={{ radio: [], spots: [], submit: [] }} />
            </WsProvider>,
        );

        act(() => TestConsumer.context.send("spots", { action: "initial" }));

        expect(unified.sendJsonMessage).toHaveBeenCalledWith({
            version: 1,
            type: "spots",
            action: "initial",
        });
        expect(connection_for("/spots_ws").connect).toBe(false);
        expect(connection_for("/submit_spot").connect).toBe(false);
        expect(connection_for("/radio").connect).toBe(false);
    });

    it("does not downgrade an established unified connection", () => {
        const { messages, rerender } = render_provider();
        const unified = connection_for("/ws");

        unified.readyState = websocket_mock.ReadyState.OPEN;
        act(() => unified.options.onOpen());
        rerender(
            <WsProvider>
                <TestConsumer messages={messages} />
            </WsProvider>,
        );

        unified.readyState = websocket_mock.ReadyState.CLOSED;
        act(() => unified.options.onClose());
        rerender(
            <WsProvider>
                <TestConsumer messages={messages} />
            </WsProvider>,
        );

        expect(unified.connect).toBe(true);
        expect(connection_for("/spots_ws").connect).toBe(false);
        expect(connection_for("/submit_spot").connect).toBe(false);
        expect(connection_for("/radio").connect).toBe(false);
    });

    it("falls back to and translates the catserver v1.2.0 endpoints", () => {
        const { messages, rerender } = render_provider();
        const unified = connection_for("/ws");

        act(() => unified.options.onClose());
        rerender(
            <WsProvider>
                <TestConsumer messages={messages} />
            </WsProvider>,
        );

        const spots = connection_for("/spots_ws");
        const submit = connection_for("/submit_spot");
        const radio = connection_for("/radio");
        spots.readyState = websocket_mock.ReadyState.OPEN;
        submit.readyState = websocket_mock.ReadyState.OPEN;
        radio.readyState = websocket_mock.ReadyState.OPEN;
        rerender(
            <WsProvider>
                <TestConsumer messages={messages} />
            </WsProvider>,
        );

        act(() => {
            TestConsumer.context.send("spots", { action: "initial" });
            TestConsumer.context.send("spots", { action: "catch_up", last_time: 123 });
            TestConsumer.context.send("submit", { dx_callsign: "K1ABC", freq: 14074 });
            TestConsumer.context.send("radio", { action: "SetRig", rig: 2 });
        });

        expect(spots.sendJsonMessage).toHaveBeenNthCalledWith(1, { initial: true });
        expect(spots.sendJsonMessage).toHaveBeenNthCalledWith(2, { last_time: 123 });
        expect(submit.sendJsonMessage).toHaveBeenCalledWith({ dx_callsign: "K1ABC", freq: 14074 });
        expect(radio.sendJsonMessage).toHaveBeenCalledWith({ type: "SetRig", rig: 2 });

        spots.lastJsonMessage = { type: "update", spots: [{ dx_callsign: "K1ABC" }] };
        submit.lastJsonMessage = { status: "failure", type: "InvalidFrequency" };
        radio.lastJsonMessage = { status: "connected", version: "catserver-v1.2.0" };
        rerender(
            <WsProvider>
                <TestConsumer messages={messages} />
            </WsProvider>,
        );

        expect(messages.spots).toContainEqual({
            version: 1,
            type: "spots",
            event: "update",
            spots: [{ dx_callsign: "K1ABC" }],
        });
        expect(messages.submit).toContainEqual({
            version: 1,
            type: "submit",
            status: "failure",
            error_type: "InvalidFrequency",
        });
        expect(messages.radio).toContainEqual({
            version: 1,
            type: "radio",
            event: "status",
            status: "connected",
            catserver_version: "catserver-v1.2.0",
        });
    });
});
