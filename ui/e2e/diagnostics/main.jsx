import RouteErrorBoundary from "@/components/RouteErrorBoundary.jsx";
import { enrich_spot_zones_if_missing } from "@/hooks/useSpotWebSocket.js";
import { UiRefreshProvider } from "@/hooks/useUiRefresh.jsx";
import { WsProvider, useWsMessage } from "@/hooks/useWs";
import { initializeSentry } from "@/sentry";
import { create_interval_db } from "@/utils/interval_cache.js";
import { get_spot_dxcc_display } from "@/utils/spot_dxcc.js";
import { addBreadcrumb, flush } from "@sentry/react";
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

function DomMutationFailingComponent() {
    const [translated, set_translated] = React.useState(false);

    React.useEffect(() => {
        document.documentElement.classList.add("translated-ltr");
        const parent = document.querySelector("[data-diagnostic-dom-mutation]");
        const text = parent.firstChild;
        const outer = document.createElement("font");
        const inner = document.createElement("font");
        outer.style.verticalAlign = "inherit";
        inner.style.verticalAlign = "inherit";
        inner.textContent = "translated";
        outer.append(inner);
        parent.insertBefore(outer, text);
        parent.removeChild(text);
        set_translated(true);
    }, []);

    return (
        <div data-diagnostic-dom-mutation>
            {translated && "selected"}
            {!translated && "unselected"}
        </div>
    );
}

function DxccFailingComponent() {
    enrich_spot_zones_if_missing({
        dx_state: "NY",
        spotter_state: null,
        spotter_dxcc_code: 1,
        spotter_loc: [-75, 40],
        spotter_callsign: "PRIVATE-CALLSIGN",
    });
    return null;
}

function DxccRenderFailingComponent() {
    get_spot_dxcc_display(
        {
            dx_dxcc_code: 291,
            dx_country: "PRIVATE-COUNTRY",
            dx_callsign: "PRIVATE-CALLSIGN",
        },
        "live",
    );
    return null;
}

function FailingSubscriber() {
    useWsMessage("radio", message => {
        if (message.event === "diagnostic_failure") return message.missing.secret;
    });
    useWsMessage("update", message => message.missing.secret);
    return null;
}

window.run_diagnostic = async scenario => {
    if (scenario === "module_recovery") {
        history.replaceState(null, "", `${location.pathname}?secret=K1ABC#private`);
        document.head.insertAdjacentHTML(
            "beforeend",
            '<meta name="ui-entry" content="/assets/current.js">',
        );
        addBreadcrumb({ category: "private", message: "K1ABC secret" });
        const native_fetch = window.fetch;
        let checks = 0;
        window.fetch = (input, options) => {
            const url = new URL(typeof input === "string" ? input : input.url, location.href);
            if (url.pathname === location.pathname && options?.headers?.Accept === "text/html") {
                checks++;
                const entry = checks === 1 ? "/assets/current.js" : "/assets/next.js";
                return Promise.resolve(
                    new Response(
                        `<meta name="ui-entry" content="${entry}"><script type="module" src="${entry}"></script>`,
                        { status: 200, headers: { "content-type": "text/html" } },
                    ),
                );
            }
            return native_fetch(input, options);
        };
        createRoot(document.getElementById("root")).render(
            <WsProvider>
                <UiRefreshProvider navigate={() => {}}>
                    <div>module recovery diagnostics</div>
                </UiRefreshProvider>
            </WsProvider>,
        );
        while (checks < 1) await new Promise(resolve => requestAnimationFrame(resolve));
        const error = new Event("vite:preloadError", { cancelable: true });
        error.payload = new TypeError("Importing a module script failed.");
        window.dispatchEvent(error);
        while (checks < 2) await new Promise(resolve => requestAnimationFrame(resolve));
        window.fetch = native_fetch;
        return;
    }
    if (["dxcc_predicate", "dxcc_render"].includes(scenario)) {
        const native_test = RegExp.prototype.test;
        let calls = 0;
        const failing_call = scenario === "dxcc_predicate" ? 2 : 1;
        RegExp.prototype.test = function (value) {
            if (this.source === "^\\d{1,3}$" && ++calls === failing_call) {
                RegExp.prototype.test = native_test;
                const error = new Error("too much recursion");
                error.name = "InternalError";
                throw error;
            }
            return native_test.call(this, value);
        };
        const Component =
            scenario === "dxcc_predicate" ? DxccFailingComponent : DxccRenderFailingComponent;
        createRoot(document.getElementById("root")).render(
            <RouteErrorBoundary>
                <Component />
            </RouteErrorBoundary>,
        );
        return;
    }
    if (scenario === "dom_mutation") {
        createRoot(document.getElementById("root")).render(
            <RouteErrorBoundary>
                <DomMutationFailingComponent />
            </RouteErrorBoundary>,
        );
        return;
    }
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
        const fallback = ["missing_store", "closed_database"].includes(scenario);
        const transaction = IDBDatabase.prototype.transaction;
        let transactions = 0;
        if (fallback) {
            IDBDatabase.prototype.transaction = function (...args) {
                transactions++;
                if (scenario === "closed_database") this.close();
                return transaction.apply(this, args);
            };
        }
        const store = create_interval_db(database, 1, "intervals");
        if (scenario === "subscriber")
            store.subscribe(() => {
                throw new TypeError("private secret subscriber");
            });
        if (fallback) {
            try {
                await store.ready();
                let updates = 0;
                store.subscribe(() => updates++);
                await store.with_lock(() => store.commit([], { start: 0, end: 10, data: [1] }));
                const records = store.get_overlapping_intervals(0, 10);
                await store.evict(20, () => null);
                const remaining = store.get_overlapping_intervals(0, 10);
                const flushed = await flush(3000);
                return { records, remaining, transactions, updates, flushed };
            } finally {
                IDBDatabase.prototype.transaction = transaction;
            }
        }
    }
};
window.diagnostics_ready = true;
