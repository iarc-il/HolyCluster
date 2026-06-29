import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

export { ReadyState };

const WS_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;

const WsContext = createContext(null);

export function WsProvider({ children }) {
    const [network_state, set_network_state] = useState("connecting");
    const subscribers_ref = useRef(new Map());

    const { sendJsonMessage, readyState, lastJsonMessage } = useWebSocket(WS_URL, {
        reconnectAttempts: Number.POSITIVE_INFINITY,
        reconnectInterval: attemptNumber => Math.min(5000 * 2 ** (attemptNumber - 1), 30000),
        shouldReconnect: () => true,
    });

    useEffect(() => {
        switch (readyState) {
            case ReadyState.CONNECTING:
                set_network_state("connecting");
                break;
            case ReadyState.OPEN:
                set_network_state("connected");
                break;
            case ReadyState.CLOSED:
                set_network_state("disconnected");
                break;
        }
    }, [readyState]);

    useEffect(() => {
        if (lastJsonMessage != null && lastJsonMessage.type) {
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
                handlers.filter(h => h !== handler)
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

    return (
        <WsContext.Provider value={{ network_state, subscribe, send, readyState }}>
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