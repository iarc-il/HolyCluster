import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

export { ReadyState };

const WS_BASE_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
const WsContext = createContext(null);

function normalize_legacy_radio_message(message) {
    const { version: catserver_version, ...data } = message;
    let event = "status";
    if (message.focus) {
        event = "focus";
    } else if (message.close) {
        event = "close";
    }

    return {
        version: 1,
        type: "radio",
        event,
        ...data,
        ...(catserver_version ? { catserver_version } : {}),
    };
}

function normalize_legacy_submit_message(message) {
    const { type: error_type, ...data } = message;
    return {
        version: 1,
        type: "submit",
        ...data,
        ...(error_type ? { error_type } : {}),
    };
}

export function WsProvider({ children }) {
    const [transport, set_transport] = useState("probing");
    const [network_state, set_network_state] = useState("connecting");
    const subscribers_ref = useRef(new Map());

    const dispatch = useCallback(message => {
        const handlers = subscribers_ref.current.get(message.type);
        if (handlers) {
            for (const handler of handlers) {
                handler(message);
            }
        }
    }, []);

    const {
        sendJsonMessage: send_unified_message,
        readyState: unified_ready_state,
        lastJsonMessage: unified_message,
    } = useWebSocket(
        `${WS_BASE_URL}/ws`,
        {
            onOpen: () => set_transport(current => (current === "probing" ? "unified" : current)),
            onClose: () => set_transport(current => (current === "probing" ? "legacy" : current)),
            reconnectAttempts: Number.POSITIVE_INFINITY,
            reconnectInterval: attemptNumber => Math.min(5000 * 2 ** (attemptNumber - 1), 30000),
            shouldReconnect: () => transport !== "legacy",
        },
        transport !== "legacy",
    );

    const legacy_options = {
        reconnectAttempts: Number.POSITIVE_INFINITY,
        reconnectInterval: attemptNumber => Math.min(5000 * 2 ** (attemptNumber - 1), 30000),
        shouldReconnect: () => true,
    };
    const {
        sendJsonMessage: send_legacy_spots_message,
        readyState: legacy_spots_ready_state,
        lastJsonMessage: legacy_spots_message,
    } = useWebSocket(`${WS_BASE_URL}/spots_ws`, legacy_options, transport === "legacy");
    const {
        sendJsonMessage: send_legacy_submit_message,
        readyState: legacy_submit_ready_state,
        lastJsonMessage: legacy_submit_message,
    } = useWebSocket(`${WS_BASE_URL}/submit_spot`, legacy_options, transport === "legacy");
    const {
        sendJsonMessage: send_legacy_radio_message,
        readyState: legacy_radio_ready_state,
        lastJsonMessage: legacy_radio_message,
    } = useWebSocket(`${WS_BASE_URL}/radio`, legacy_options, transport === "legacy");

    const readyState = transport === "legacy" ? legacy_spots_ready_state : unified_ready_state;

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
        if (transport !== "legacy" && unified_message?.type) {
            dispatch(unified_message);
        }
    }, [dispatch, transport, unified_message]);

    useEffect(() => {
        if (transport === "legacy" && legacy_spots_message) {
            const { type: event, ...data } = legacy_spots_message;
            dispatch({ version: 1, type: "spots", event, ...data });
        }
    }, [dispatch, legacy_spots_message, transport]);

    useEffect(() => {
        if (transport === "legacy" && legacy_submit_message) {
            dispatch(normalize_legacy_submit_message(legacy_submit_message));
        }
    }, [dispatch, legacy_submit_message, transport]);

    useEffect(() => {
        if (transport === "legacy" && legacy_radio_message) {
            dispatch(normalize_legacy_radio_message(legacy_radio_message));
        }
    }, [dispatch, legacy_radio_message, transport]);

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
            if (transport !== "legacy") {
                if (unified_ready_state === ReadyState.OPEN) {
                    send_unified_message({ version: 1, type, ...data });
                }
                return;
            }

            if (type === "spots") {
                if (legacy_spots_ready_state !== ReadyState.OPEN) {
                    return;
                }
                if (data.action === "initial") {
                    send_legacy_spots_message({ initial: true });
                } else if (data.action === "catch_up") {
                    send_legacy_spots_message({ last_time: data.last_time });
                }
            } else if (type === "submit" && legacy_submit_ready_state === ReadyState.OPEN) {
                send_legacy_submit_message(data);
            } else if (type === "radio" && legacy_radio_ready_state === ReadyState.OPEN) {
                const { action, ...message } = data;
                send_legacy_radio_message({ type: action, ...message });
            }
        },
        [
            send_legacy_radio_message,
            send_legacy_spots_message,
            send_legacy_submit_message,
            send_unified_message,
            legacy_radio_ready_state,
            legacy_spots_ready_state,
            legacy_submit_ready_state,
            transport,
            unified_ready_state,
        ],
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
