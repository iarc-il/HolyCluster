import RouteErrorBoundary from "@/components/RouteErrorBoundary.jsx";
import { WsProvider, useWsMessage } from "@/hooks/useWs";
import { initializeSentry } from "@/sentry";
import { create_interval_db } from "@/utils/interval_cache.js";
import { flush } from "@sentry/react";
import React from "react";
import { createRoot } from "react-dom/client";

initializeSentry({
    dsn: `${location.origin.replace("://", "://public@")}/1`,
    release: "diagnostic-browser-test",
    environment: "test",
});

function fail_render() {
    const missing = undefined;
    return missing.secret;
}

function FailingComponent() {
    return fail_render();
}

function PrimitiveFailingComponent() {
    const thrown_value = "diagnostic primitive boundary failure";
    throw thrown_value;
}

function CauseFailingComponent() {
    const cause = new Error("diagnostic boundary cause");
    throw new TypeError("diagnostic boundary failure", { cause });
}

function FailingSubscriber() {
    useWsMessage("radio", message => {
        if (message.event === "diagnostic_failure") return message.missing.secret;
    });
    useWsMessage("update", message => message.missing.secret);
    return null;
}

window.run_diagnostic = async scenario => {
    if (["websocket", "websocket_update"].includes(scenario)) {
        createRoot(document.getElementById("root")).render(
            <RouteErrorBoundary>
                <WsProvider>
                    <FailingSubscriber />
                </WsProvider>
            </RouteErrorBoundary>,
        );
        return;
    }
    if (["boundary", "boundary_primitive", "boundary_cause"].includes(scenario)) {
        const Component =
            scenario === "boundary_primitive"
                ? PrimitiveFailingComponent
                : scenario === "boundary_cause"
                  ? CauseFailingComponent
                  : FailingComponent;
        createRoot(document.getElementById("root")).render(
            <RouteErrorBoundary>
                <Component />
            </RouteErrorBoundary>,
        );
    } else if (scenario === "cross_realm") {
        const frame = document.createElement("iframe");
        document.body.append(frame);
        const error = new frame.contentWindow.TypeError(
            "Cannot read properties of undefined (reading 'secret')",
        );
        Promise.reject(error);
    } else if (scenario === "primitive") {
        Promise.reject("private secret rejection");
    } else if (scenario === "stackless") {
        const error = new TypeError("Cannot read properties of undefined (reading 'secret')");
        error.stack = undefined;
        Promise.reject(error);
    } else if (scenario === "global_oom") {
        window.dispatchEvent(
            new ErrorEvent("error", {
                message: "out of memory",
                error: "out of memory",
                filename: `${location.origin}/assets/synthetic.js`,
                lineno: 1,
            }),
        );
        await flush(3000);
        window.dispatchEvent(
            new ErrorEvent("error", {
                message: "out of memory",
                error: new Error("out of memory"),
            }),
        );
        await flush(3000);
    } else if (scenario === "cache_abort") {
        const cache = await import("@/utils/propagation_cache_db.jsx");
        const handlers = new Set();
        let requests = 0;
        let updates = 0;
        cache.subscribe(() => updates++);
        const send = (_, request) => {
            requests++;
            queueMicrotask(() => {
                for (const handler of handlers)
                    handler({
                        ...request,
                        metrics: { sfi: [{ timestamp: request.start_time, value: 123 }] },
                    });
            });
        };
        const subscribe = (_, handler) => {
            handlers.add(handler);
            return () => handlers.delete(handler);
        };
        const start = Date.now();
        const end = start + 3_600_000;
        await cache.ensure_propagation_loaded(send, subscribe, async () => {}, start, end);
        await cache.ensure_propagation_loaded(send, subscribe, async () => {}, start, end);
        await cache.evict_old_records();
        return { ...cache.get_propagation(start, end), requests, updates, handlers: handlers.size };
    } else if (["missing_store", "closed_database", "subscriber", "version"].includes(scenario)) {
        const database = "holycluster_spot_cache";
        await new Promise((resolve, reject) => {
            const request = indexedDB.open(database, scenario === "version" ? 2 : 1);
            request.onupgradeneeded = () => {
                if (scenario !== "missing_store")
                    request.result.createObjectStore("intervals", {
                        keyPath: "id",
                        autoIncrement: true,
                    });
            };
            request.onsuccess = () => {
                request.result.close();
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
        if (scenario === "closed_database") {
            const transaction = IDBDatabase.prototype.transaction;
            IDBDatabase.prototype.transaction = function (...args) {
                this.close();
                return transaction.apply(this, args);
            };
        }
        const store = create_interval_db(database, 1, "intervals");
        if (scenario === "subscriber")
            store.subscribe(() => {
                throw new TypeError("private secret subscriber");
            });
    }
};
window.diagnostics_ready = true;
