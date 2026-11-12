import { annotateDiagnosticError, recordDiagnosticAction } from "@/sentry";
import { browser_type, client_type } from "@/utils/client_type.js";
import { create_server_clock } from "@/utils/server_clock.js";
import { get_user_id } from "@/utils/user_id.js";
import { captureException } from "@sentry/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

export { ReadyState };

const WS_BASE_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
const WsContext = createContext(null);

const reconnect_options = {
    reconnectAttempts: Number.POSITIVE_INFINITY,
    reconnectInterval: attemptNumber => Math.min(5000 * 2 ** (attemptNumber - 1), 30000),
    shouldReconnect: () => true,
};

export function WsProvider({ children }) {
    const [connection_generation, set_connection_generation] = useState(0);
    const [spot_socket_epochs, set_spot_socket_epochs] = useState({});
    const spot_socket_epochs_ref = useRef({});
    const catserver_version_ref = useRef(null);
    const next_spot_socket_epoch_ref = useRef(0);
    const open_spot_socket = candidate => {
        const epoch = ++next_spot_socket_epoch_ref.current;
        spot_socket_epochs_ref.current[candidate] = epoch;
        set_spot_socket_epochs({ ...spot_socket_epochs_ref.current });
    };
    const close_spot_socket = candidate => {
        delete spot_socket_epochs_ref.current[candidate];
        set_spot_socket_epochs({ ...spot_socket_epochs_ref.current });
    };
    const [network_state, set_network_state] = useState("connecting");
    const server_clock_ref = useRef(null);
    if (server_clock_ref.current === null) server_clock_ref.current = create_server_clock();
    const [clock_revision, set_clock_revision] = useState(0);
    const subscribers_ref = useRef(new Map());
    const ready_state_ref = useRef(ReadyState.CONNECTING);
    const ready_waiters_ref = useRef([]);
    const send_state_ref = useRef(null);

    const dispatch = useCallback(message => {
        if (message.type === "spots") {
            const was_synchronized = server_clock_ref.current.is_server_time();
            if (server_clock_ref.current.synchronize(message.server_time) && !was_synchronized) {
                set_clock_revision(revision => revision + 1);
            }
        }
        if (message.type === "radio" && message.event === "status") {
            if (typeof message.catserver_version === "string") {
                catserver_version_ref.current = message.catserver_version;
            } else if (message.version === 1 && message.status === "unavailable") {
                catserver_version_ref.current = null;
            }
        }
        const handlers = subscribers_ref.current.get(message.type);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(message);
                } catch (error) {
                    throw annotateDiagnosticError(error, {
                        operation: "websocket_message",
                        stage: "subscriber",
                        message_type: message.type,
                        transport: "unified",
                    });
                }
            }
        }
    }, []);

    const {
        sendJsonMessage: send_unified_message,
        readyState: unified_ready_state,
        lastJsonMessage: unified_message,
    } = useWebSocket(
        `${WS_BASE_URL}/ws${connection_generation ? `?resume=${connection_generation}` : ""}`,
        {
            ...reconnect_options,
            onOpen: () => open_spot_socket("unified"),
            onClose: () => {
                close_spot_socket("unified");
                catserver_version_ref.current = null;
            },
            onMessage: event => {
                let message;
                try {
                    message = JSON.parse(event.data);
                } catch {
                    return;
                }
                if (message?.type === "update") {
                    try {
                        dispatch(message);
                    } catch (error) {
                        // The old parse catch also swallowed subscriber failures.
                        // Keep callback behavior unchanged, but report the failure.
                        captureException(error);
                    }
                }
            },
        },
        true,
    );

    useEffect(() => {
        if (unified_ready_state === ReadyState.OPEN) {
            send_unified_message({ version: 1, type: "radio", action: "GetCapabilities" }, false);
        }
    }, [send_unified_message, unified_ready_state]);

    const readyState = unified_ready_state;
    const radioReadyState = unified_ready_state;

    ready_state_ref.current = readyState;
    send_state_ref.current = { unified_ready_state, send_unified_message };

    useEffect(() => {
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
        if (!unified_message?.type || unified_message.type === "update") return;
        dispatch(unified_message);
    }, [dispatch, unified_message]);

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

    const with_versions = useCallback((type, data) => {
        if (type !== "spots") return data;
        return {
            ...data,
            software_id: "HolyCluster",
            ui_version: import.meta.env.VITE_UI_VERSION ?? null,
            catserver_version: catserver_version_ref.current,
            client_type: client_type(),
            browser_type: browser_type(),
            user_id: get_user_id(),
        };
    }, []);

    const send = useCallback(
        (type, data) => {
            if (type === "radio" || type === "rotator") recordDiagnosticAction(data?.action);
            const { unified_ready_state, send_unified_message } = send_state_ref.current;
            data = with_versions(type, data);
            if (unified_ready_state === ReadyState.OPEN) {
                send_unified_message({ version: 1, type, ...data });
                return true;
            }
            return false;
        },
        [with_versions],
    );

    const spot_socket_epoch =
        readyState === ReadyState.OPEN ? (spot_socket_epochs.unified ?? null) : null;

    const send_now = useCallback(
        (type, data, epoch) => {
            const state = send_state_ref.current;
            if (epoch == null || spot_socket_epochs_ref.current.unified !== epoch) return false;
            data = with_versions(type, data);
            if (state.unified_ready_state === ReadyState.OPEN) {
                state.send_unified_message({ version: 1, type, ...data }, false);
                return true;
            }
            return false;
        },
        [with_versions],
    );

    const wait_for_open = useCallback(signal => {
        if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
        if (ready_state_ref.current === ReadyState.OPEN) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const finish = error => {
                clearTimeout(timer);
                signal?.removeEventListener("abort", on_abort);
                ready_waiters_ref.current = ready_waiters_ref.current.filter(
                    waiter => waiter !== finish,
                );
                if (error) reject(error);
                else resolve();
            };
            const on_abort = () => finish(new DOMException("Aborted", "AbortError"));
            const timer = setTimeout(
                () => finish(new Error("WebSocket connection timed out")),
                10_000,
            );
            signal?.addEventListener("abort", on_abort);
            ready_waiters_ref.current.push(finish);
        });
    }, []);

    useEffect(
        () => () => {
            for (const finish of ready_waiters_ref.current) {
                finish(new DOMException("Aborted", "AbortError"));
            }
        },
        [],
    );

    const reconnect = useCallback(() => {
        set_connection_generation(current => current + 1);
    }, []);

    return (
        <WsContext.Provider
            value={{
                network_state,
                subscribe,
                send,
                send_now,
                spot_socket_epoch,
                readyState,
                radioReadyState,
                wait_for_open,
                reconnect,
                now_ms: server_clock_ref.current.now_ms,
                is_server_time: server_clock_ref.current.is_server_time(),
                clock_revision,
            }}
        >
            {children}
        </WsContext.Provider>
    );
}

export function useWs() {
    return useContext(WsContext);
}

export function useServerClock() {
    const { now_ms, is_server_time, clock_revision } = useWs();
    return { now_ms, is_server_time, clock_revision };
}

export function useWsMessage(type, handler) {
    const { subscribe } = useWs();
    useEffect(() => subscribe(type, handler), [type, handler, subscribe]);
}
