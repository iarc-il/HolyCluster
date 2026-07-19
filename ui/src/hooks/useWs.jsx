import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

export { ReadyState };

const WS_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;

const WsContext = createContext(null);

export function WsProvider({ children }) {
    const [network_state, set_network_state] = useState("connecting");
    const subscribers_ref = useRef(new Map());
    const ready_state_ref = useRef(ReadyState.CONNECTING);
    const ready_waiters_ref = useRef([]);

    const { sendJsonMessage, readyState, lastJsonMessage } = useWebSocket(WS_URL, {
        reconnectAttempts: Number.POSITIVE_INFINITY,
        reconnectInterval: attemptNumber => Math.min(5000 * 2 ** (attemptNumber - 1), 30000),
        shouldReconnect: () => true,
    });

    useEffect(() => {
        ready_state_ref.current = readyState;

        switch (readyState) {
            case ReadyState.CONNECTING:
                set_network_state("connecting");
                break;
            case ReadyState.OPEN:
                set_network_state("connected");
                for (const resolve of ready_waiters_ref.current) resolve();
                ready_waiters_ref.current = [];
                break;
            case ReadyState.CLOSED:
                set_network_state("disconnected");
                break;
        }
    }, [readyState]);

    useEffect(() => {
        if (lastJsonMessage?.type) {
            const handlers = subscribers_ref.current.get(lastJsonMessage.type);
            if (handlers) {
                for (const handler of handlers) {
                    handler(lastJsonMessage);
                }
            }
        }
    }, [lastJsonMessage]);

    const subscribe = useCallback((type, handler) => {
        const handlers = subscribers_ref.current.get(type) || [];
        handlers.push(handler);
        subscribers_ref.current.set(type, handlers);
        return () => {
            const handlers = subscribers_ref.current.get(type) || [];
            subscribers_ref.current.set(
                type,
                handlers.filter(h => h !== handler),
            );
        };
    }, []);

    const send = useCallback(
        (type, data) => {
            if (readyState === ReadyState.OPEN) {
                sendJsonMessage({ version: 1, type, ...data });
            }
        },
        [readyState, sendJsonMessage],
    );

    const wait_for_open = useCallback(() => {
        if (ready_state_ref.current === ReadyState.OPEN) return Promise.resolve();
        return new Promise(resolve => {
            ready_waiters_ref.current.push(resolve);
        });
    }, []);

    return (
        <WsContext.Provider value={{ network_state, subscribe, send, readyState, wait_for_open }}>
            {children}
        </WsContext.Provider>
    );
}

export function useWs() {
    return useContext(WsContext);
}

export function useWsMessage(type, handler) {
    const { subscribe } = useWs();
    useEffect(() => subscribe(type, handler), [type, handler, subscribe]);
}
