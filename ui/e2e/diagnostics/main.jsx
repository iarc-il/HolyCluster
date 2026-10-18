import RouteErrorBoundary from "@/components/RouteErrorBoundary.jsx";
import { WsProvider, useWsMessage } from "@/hooks/useWs";
import { initializeSentry } from "@/sentry";
import { create_interval_db } from "@/utils/interval_cache.js";
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
