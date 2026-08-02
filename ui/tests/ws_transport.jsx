import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const websocket_mock = vi.hoisted(() => {
    const ReadyState = { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, UNINSTANTIATED: -1 };
    const connection = {
        lastJsonMessage: null,
        readyState: ReadyState.CONNECTING,
        sendJsonMessage: vi.fn(),
    };
    return {
        ReadyState,
        connection,
        useWebSocket: vi.fn((url, options) => ({ ...connection, url, options })),
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

describe("WebSocket transport", () => {
    beforeEach(() => {
        websocket_mock.useWebSocket.mockClear();
        websocket_mock.connection.readyState = websocket_mock.ReadyState.CONNECTING;
        websocket_mock.connection.sendJsonMessage.mockClear();
        TestConsumer.context = null;
    });

    afterEach(() => cleanup());

    it("uses only the unified endpoint", () => {
        const messages = [];
        const { rerender } = render(
            <WsProvider>
                <TestConsumer messages={messages} />
            </WsProvider>,
        );
        const connection = websocket_mock.connection;

        expect(websocket_mock.useWebSocket.mock.calls[0][0]).toMatch(/\/ws$/);
        expect(websocket_mock.useWebSocket).toHaveBeenCalledTimes(1);
        connection.readyState = websocket_mock.ReadyState.OPEN;
        rerender(
            <WsProvider>
                <TestConsumer messages={messages} />
            </WsProvider>,
        );

        act(() => TestConsumer.context.send("radio", { action: "SetRig", rig: 2 }));
        expect(connection.sendJsonMessage).toHaveBeenCalledWith({
            version: 1,
            type: "radio",
            action: "SetRig",
            rig: 2,
        });
    });
});
