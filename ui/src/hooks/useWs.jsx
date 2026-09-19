import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

export { ReadyState };

const WS_BASE_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
const WS_PROBE_TIMEOUT_MS = 1500;
const WsContext = createContext(null);

/** @deprecated CAT <=1.2 compatibility; remove when the minimum supported CAT version exceeds 1.2. */
function normalize_cat_v1_2_radio_message(message) {
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

/** @deprecated CAT <=1.2 compatibility; remove when the minimum supported CAT version exceeds 1.2. */
function cat_v1_2_message(type, data) {
    if (type === "radio") {
        const { action, ...message } = data;
        return { type: action, ...message };
    }
    return { version: 1, type, ...data };
}

const reconnect_options = {
    reconnectAttempts: Number.POSITIVE_INFINITY,
    reconnectInterval: attemptNumber => Math.min(5000 * 2 ** (attemptNumber - 1), 30000),
    shouldReconnect: () => true,
};

export function WsProvider({ children }) {
    const [transport, set_transport] = useState("probing");
    const [network_state, set_network_state] = useState("connecting");
    const subscribers_ref = useRef(new Map());
    const ready_state_ref = useRef(ReadyState.CONNECTING);
    const ready_waiters_ref = useRef([]);

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
            ...reconnect_options,
            onOpen: () => set_transport(current => (current === "probing" ? "unified" : current)),
            onClose: () => set_transport(current => (current === "probing" ? "cat_v1_2" : current)),
            shouldReconnect: () => transport !== "cat_v1_2",
        },
        transport !== "cat_v1_2",
    );

    const {
        sendJsonMessage: send_compatibility_message,
        readyState: compatibility_ready_state,
        lastJsonMessage: compatibility_message,
    } = useWebSocket(`${WS_BASE_URL}/submit_spot`, reconnect_options, transport === "cat_v1_2");

    const {
        sendJsonMessage: send_compatibility_radio_message,
        readyState: compatibility_radio_ready_state,
        lastJsonMessage: compatibility_radio_message,
    } = useWebSocket(`${WS_BASE_URL}/radio`, reconnect_options, transport === "cat_v1_2");

    const readyState = transport === "cat_v1_2" ? compatibility_ready_state : unified_ready_state;
    const radioReadyState =
        transport === "cat_v1_2" ? compatibility_radio_ready_state : unified_ready_state;

    useEffect(() => {
        if (transport !== "probing") return;
        const timeout = setTimeout(() => set_transport("cat_v1_2"), WS_PROBE_TIMEOUT_MS);
        return () => clearTimeout(timeout);
    }, [transport]);

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
        if (transport !== "cat_v1_2" && unified_message?.type) {
            dispatch(unified_message);
        }
    }, [dispatch, transport, unified_message]);

    useEffect(() => {
        if (transport === "cat_v1_2" && compatibility_message?.type) {
            dispatch(compatibility_message);
        }
    }, [compatibility_message, dispatch, transport]);

    useEffect(() => {
        if (transport === "cat_v1_2" && compatibility_radio_message) {
            dispatch(normalize_cat_v1_2_radio_message(compatibility_radio_message));
        }
    }, [compatibility_radio_message, dispatch, transport]);

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
            if (transport === "cat_v1_2") {
                if (type === "radio") {
                    if (compatibility_radio_ready_state === ReadyState.OPEN) {
                        send_compatibility_radio_message(cat_v1_2_message(type, data));
                    }
                } else if (compatibility_ready_state === ReadyState.OPEN) {
                    send_compatibility_message(cat_v1_2_message(type, data));
                }
                return;
            }

            if (unified_ready_state === ReadyState.OPEN) {
                send_unified_message({ version: 1, type, ...data });
            }
        },
        [
            compatibility_radio_ready_state,
            compatibility_ready_state,
            send_compatibility_message,
            send_compatibility_radio_message,
            send_unified_message,
            transport,
            unified_ready_state,
        ],
    );

    const wait_for_open = useCallback(() => {
        if (ready_state_ref.current === ReadyState.OPEN) return Promise.resolve();
        return new Promise(resolve => {
            ready_waiters_ref.current.push(resolve);
        });
    }, []);

    return (
        <WsContext.Provider
            value={{
                network_state,
                subscribe,
                send,
                readyState,
                radioReadyState,
                wait_for_open,
            }}
        >
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
