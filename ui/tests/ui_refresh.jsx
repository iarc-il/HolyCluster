import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const detection = vi.hoisted(() => ({ check: vi.fn() }));
const diagnostics = vi.hoisted(() => ({ capture: vi.fn(), report: vi.fn() }));
const websocket = vi.hoisted(() => ({ current: null, send: vi.fn() }));

vi.mock("@sentry/react", () => ({ captureException: diagnostics.capture }));
vi.mock("@/sentry.js", () => ({ reportModuleRecoveryDiagnostic: diagnostics.report }));
vi.mock("@/module_load_recovery.js", () => ({ detect_ui_build: detection.check }));
vi.mock("@/hooks/useWs", () => ({
    ReadyState: { OPEN: 1 },
    useWs: () => websocket.current,
}));

import {
    UiRefreshProvider,
    useUiRefresh,
    useUiRefreshBlocker,
    useUiRefreshGraceBlocker,
} from "@/hooks/useUiRefresh.jsx";

function Consumer() {
    Consumer.refresh = useUiRefresh();
    return null;
}

function Blocker({ active, reason = "modal" }) {
    useUiRefreshBlocker(active, reason);
    return null;
}

function GraceBlocker() {
    GraceBlocker.blocker = useUiRefreshGraceBlocker("radio", 5 * 60 * 1000);
    return null;
}

function preload_error(
    message = "Importing a module script failed.",
    { name = "TypeError", source_url } = {},
) {
    const event = new Event("vite:preloadError", { cancelable: true });
    event.payload = new Error(message);
    event.payload.name = name;
    if (source_url) event.payload.sourceURL = source_url;
    return event;
}

function render_provider(props = {}) {
    return render(
        <UiRefreshProvider {...props}>
            <Consumer />
        </UiRefreshProvider>,
    );
}

beforeEach(() => {
    vi.useFakeTimers();
    detection.check.mockReset();
    diagnostics.capture.mockReset().mockReturnValue("0123456789abcdef0123456789abcdef");
    diagnostics.report.mockReset();
    websocket.current = null;
    websocket.send.mockReset();
    sessionStorage.clear();
    document.head.insertAdjacentHTML(
        "beforeend",
        '<meta name="ui-entry" content="/assets/current.js">',
    );
});

afterEach(() => {
    cleanup();
    document.querySelector('meta[name="ui-entry"]')?.remove();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

it("keeps a grace blocker until its matching result or timeout", async () => {
    detection.check.mockResolvedValue(null);
    render(
        <UiRefreshProvider>
            <GraceBlocker />
            <Consumer />
        </UiRefreshProvider>,
    );
    await act(() => vi.advanceTimersByTimeAsync(0));

    act(() => GraceBlocker.blocker.start("configuration"));
    expect(Consumer.refresh.blockers).toEqual(["radio"]);
    act(() => GraceBlocker.blocker.finish("other"));
    expect(Consumer.refresh.blockers).toEqual(["radio"]);
    await act(() => vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1));
    expect(Consumer.refresh.blockers).toEqual(["radio"]);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(Consumer.refresh.blockers).toEqual([]);

    act(() => GraceBlocker.blocker.start("retry"));
    expect(Consumer.refresh.blockers).toEqual(["radio"]);
    act(() => GraceBlocker.blocker.finish("retry"));
    expect(Consumer.refresh.blockers).toEqual([]);
});

it("keeps blocker registration stable through Strict Mode cleanup", async () => {
    detection.check.mockResolvedValue(null);
    const view = render(
        <StrictMode>
            <UiRefreshProvider>
                <Blocker active={true} />
                <Consumer />
            </UiRefreshProvider>
        </StrictMode>,
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(Consumer.refresh.blockers).toEqual(["modal"]);

    view.rerender(
        <StrictMode>
            <UiRefreshProvider>
                <Blocker active={false} />
                <Consumer />
            </UiRefreshProvider>
        </StrictMode>,
    );
    expect(Consumer.refresh.blockers).toEqual([]);
});

it("suppresses and immediately recovers a confirmed stale module while hidden", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    detection.check.mockResolvedValueOnce(null).mockResolvedValueOnce({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));

    const error = preload_error();
    expect(window.dispatchEvent(error)).toBe(false);
    expect(error.defaultPrevented).toBe(true);
    expect(diagnostics.capture).toHaveBeenCalledWith(error.payload);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(navigate).toHaveBeenCalledTimes(1);
});

it("reports probe evidence before navigating after a stale module failure", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    let finish;
    detection.check.mockResolvedValueOnce(null).mockImplementationOnce(
        ({ on_diagnostic }) =>
            new Promise(resolve => {
                on_diagnostic({
                    page_entry: "/assets/current.js",
                    probed_entry: "/assets/next.js",
                    probe_outcome: "html_parsed",
                    probe_status: 200,
                    probe_content_type: "text/html",
                    probe_reason: "new_build",
                });
                finish = () =>
                    resolve({
                        current_entry: "/assets/current.js",
                        target_entry: "/assets/next.js",
                    });
            }),
    );
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));

    const event = preload_error();
    act(() => window.dispatchEvent(event));
    expect(diagnostics.capture).toHaveBeenCalledWith(event.payload);
    expect(diagnostics.report).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();

    await act(async () => finish());
    expect(diagnostics.report).toHaveBeenCalledExactlyOnceWith({
        failure: "dynamic_import",
        exception_event_id: "0123456789abcdef0123456789abcdef",
        page_entry: "/assets/current.js",
        probed_entry: "/assets/next.js",
        probe_outcome: "html_parsed",
        probe_status: 200,
        probe_content_type: "text/html",
        probe_reason: "new_build",
        decision: "navigate",
        reason: "new_build",
        reload_requested: true,
        online: true,
        visibility: "hidden",
    });
    expect(navigate).toHaveBeenCalledTimes(1);
});

it("reloads an active page immediately after a stale module failure", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    detection.check.mockResolvedValueOnce(null).mockImplementationOnce(({ on_diagnostic }) => {
        on_diagnostic({ probe_reason: "new_build", probed_entry: "/assets/next.js" });
        return Promise.resolve({
            current_entry: "/assets/current.js",
            target_entry: "/assets/next.js",
        });
    });
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => window.dispatchEvent(preload_error()));
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(diagnostics.report).toHaveBeenLastCalledWith(
        expect.objectContaining({
            decision: "navigate",
            reason: "new_build",
            reload_requested: true,
        }),
    );
    expect(navigate).toHaveBeenCalledTimes(1);
});

it.each([
    [
        "storage_unavailable",
        () =>
            vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
                throw new Error("blocked");
            }),
    ],
    [
        "already_attempted",
        () => sessionStorage.setItem("holycluster_ui_last_auto_target", "/assets/next.js"),
    ],
])("reports manual recovery when automatic navigation is %s", async (reason, arrange) => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    detection.check.mockResolvedValueOnce(null).mockResolvedValueOnce({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));
    arrange();
    act(() => window.dispatchEvent(preload_error()));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(diagnostics.report).toHaveBeenLastCalledWith(
        expect.objectContaining({ decision: "manual", reason, reload_requested: false }),
    );
    expect(navigate).not.toHaveBeenCalled();
});

it("keeps recovery evidence with a fresh check queued behind a periodic check", async () => {
    let finish_periodic;
    detection.check
        .mockReturnValueOnce(new Promise(resolve => (finish_periodic = resolve)))
        .mockImplementationOnce(({ on_diagnostic }) => {
            on_diagnostic({ probe_reason: "same_entry", probed_entry: "/assets/current.js" });
            return Promise.resolve(null);
        });
    render_provider();
    act(() => window.dispatchEvent(preload_error()));
    expect(detection.check).toHaveBeenCalledTimes(1);
    await act(async () => finish_periodic(null));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(detection.check).toHaveBeenCalledTimes(2);
    expect(diagnostics.report).toHaveBeenCalledWith(
        expect.objectContaining({
            probed_entry: "/assets/current.js",
            probe_reason: "same_entry",
            decision: "manual",
            reason: "update_not_confirmed",
        }),
    );
});

it("keeps recovery evidence when another fresh check is already queued", async () => {
    let finish_periodic;
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    detection.check
        .mockReturnValueOnce(new Promise(resolve => (finish_periodic = resolve)))
        .mockImplementationOnce(({ on_diagnostic }) => {
            on_diagnostic({ probe_reason: "new_build", probed_entry: "/assets/next.js" });
            return Promise.resolve({
                current_entry: "/assets/current.js",
                target_entry: "/assets/next.js",
            });
        });
    render_provider();
    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => window.dispatchEvent(preload_error()));
    await act(async () => finish_periodic(null));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(detection.check).toHaveBeenCalledTimes(2);
    expect(diagnostics.report).toHaveBeenCalledWith(
        expect.objectContaining({
            probed_entry: "/assets/next.js",
            probe_reason: "new_build",
            decision: "navigate",
        }),
    );
});

it("keeps the confirmed recovery target after navigation starts", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    detection.check
        .mockResolvedValueOnce(null)
        .mockImplementationOnce(({ on_diagnostic }) => {
            on_diagnostic({ probe_reason: "new_build", probed_entry: "/assets/next.js" });
            return Promise.resolve({
                current_entry: "/assets/current.js",
                target_entry: "/assets/next.js",
            });
        })
        .mockImplementationOnce(({ on_diagnostic }) => {
            on_diagnostic({ probe_reason: "new_build", probed_entry: "/assets/newest.js" });
            return Promise.resolve({
                current_entry: "/assets/current.js",
                target_entry: "/assets/newest.js",
            });
        });
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => window.dispatchEvent(preload_error()));
    await act(() => vi.advanceTimersByTimeAsync(0));

    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(diagnostics.report).toHaveBeenLastCalledWith(
        expect.objectContaining({
            probed_entry: "/assets/next.js",
            decision: "navigate",
            reload_requested: true,
        }),
    );
    expect(detection.check).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledTimes(1);
});

it("does not let original exception reporting failure stop stale-module recovery", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    diagnostics.capture.mockImplementation(() => {
        throw new Error("capture failed");
    });
    detection.check.mockResolvedValueOnce(null).mockResolvedValueOnce({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => window.dispatchEvent(preload_error()));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(navigate).toHaveBeenCalledTimes(1);
});

it("does not let reporting failure delay stale-module navigation", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    detection.check.mockResolvedValueOnce(null).mockResolvedValueOnce({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    diagnostics.report.mockImplementation(() => {
        throw new Error("telemetry failed");
    });
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => window.dispatchEvent(preload_error()));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(navigate).toHaveBeenCalledTimes(1);
});

it("recovers a truncated same-origin module reported by WebKit", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    detection.check.mockResolvedValueOnce(null).mockResolvedValueOnce({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));

    const error = preload_error("Unexpected end of script", {
        name: "SyntaxError",
        source_url: `${window.location.origin}/assets/dxcc-0-79NMQeoG.js`,
    });
    expect(window.dispatchEvent(error)).toBe(false);
    expect(error.defaultPrevented).toBe(true);
    expect(diagnostics.capture).toHaveBeenCalledWith(error.payload);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(navigate).toHaveBeenCalledTimes(1);
});

it("does not suppress unrelated WebKit syntax errors", async () => {
    detection.check.mockResolvedValue(null);
    render_provider();
    await act(() => vi.advanceTimersByTimeAsync(0));

    for (const source_url of [
        undefined,
        "https://external.invalid/assets/dxcc-0-79NMQeoG.js",
        `${window.location.origin}/assets/dxcc-0-79NMQeoG.js?partial=1`,
    ]) {
        const error = preload_error("Unexpected end of script", {
            name: "SyntaxError",
            source_url,
        });
        expect(window.dispatchEvent(error)).toBe(true);
        expect(error.defaultPrevented).toBe(false);
    }
    expect(diagnostics.capture).not.toHaveBeenCalled();
});

it("reloads immediately after a stale module failure on an active page", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    detection.check.mockResolvedValueOnce(null).mockResolvedValueOnce({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => window.dispatchEvent(preload_error()));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(navigate).toHaveBeenCalledTimes(1);
});

it("reloads immediately after a stale module failure despite a blocker", async () => {
    detection.check.mockResolvedValueOnce(null).mockResolvedValueOnce({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    const navigate = vi.fn();
    render(
        <UiRefreshProvider navigate={navigate}>
            <Blocker active={true} />
            <Consumer />
        </UiRefreshProvider>,
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => window.dispatchEvent(preload_error()));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(navigate).toHaveBeenCalledTimes(1);
});

it("requires manual recovery when a stale module is not a confirmed update", async () => {
    detection.check.mockResolvedValue(null);
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => window.dispatchEvent(preload_error()));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(navigate).not.toHaveBeenCalled();
    expect(Consumer.refresh.stale_recovery.status).toBe("manual");
});

it("does not suppress unrelated preload errors", async () => {
    detection.check.mockResolvedValue(null);
    render_provider();
    await act(() => vi.advanceTimersByTimeAsync(0));
    const error = preload_error("e.jsx is not a function");
    expect(window.dispatchEvent(error)).toBe(true);
    expect(error.defaultPrevented).toBe(false);
    expect(diagnostics.capture).not.toHaveBeenCalled();
});

it("reports detection and manual refresh without delaying navigation", async () => {
    websocket.current = { readyState: 1, send: websocket.send };
    detection.check.mockResolvedValue({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(websocket.send).toHaveBeenCalledWith("ui_refresh", {
        event: "detected",
        blocker: "none",
    });

    act(() => Consumer.refresh.manual_reload());
    expect(websocket.send).toHaveBeenCalledWith("ui_refresh", {
        event: "manual_reload",
        blocker: "none",
    });
    expect(navigate).toHaveBeenCalledTimes(1);
});

it("reports blocked and automatic refresh evaluations", async () => {
    websocket.current = { readyState: 1, send: websocket.send };
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    detection.check.mockResolvedValue({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    const navigate = vi.fn();
    render(
        <UiRefreshProvider navigate={navigate}>
            <Blocker active={true} />
            <Consumer />
        </UiRefreshProvider>,
    );
    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(websocket.send).toHaveBeenCalledWith("ui_refresh", {
        event: "blocked",
        blocker: "modal",
    });
    expect(navigate).not.toHaveBeenCalled();

    cleanup();
    websocket.send.mockClear();
    detection.check.mockResolvedValue({
        current_entry: "/assets/current.js",
        target_entry: "/assets/newest.js",
    });
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => Consumer.refresh.automatic_reload());
    expect(websocket.send).toHaveBeenCalledWith("ui_refresh", {
        event: "auto_reload",
        blocker: "none",
    });
    expect(navigate).toHaveBeenCalledTimes(1);
});

it("waits for an active build check before automatically refreshing", async () => {
    let finish_check;
    detection.check
        .mockResolvedValueOnce({
            current_entry: "/assets/current.js",
            target_entry: "/assets/next.js",
        })
        .mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finish_check = resolve;
                }),
        );
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));

    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(detection.check).toHaveBeenCalledTimes(2);
    expect(navigate).not.toHaveBeenCalled();

    await act(async () => finish_check(null));
    expect(navigate).toHaveBeenCalledTimes(1);
});

it("automatically refreshes a visible page after one hour without activity", async () => {
    detection.check.mockResolvedValue({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));

    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000 - 1));
    expect(navigate).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(navigate).toHaveBeenCalledTimes(1);
});

it("ignores synthetic interaction when calculating inactivity", async () => {
    detection.check.mockResolvedValue({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() => vi.advanceTimersByTimeAsync(59 * 60 * 1000));
    act(() => window.dispatchEvent(new Event("pointerdown")));
    await act(() => vi.advanceTimersByTimeAsync(60 * 1000));
    expect(navigate).toHaveBeenCalledTimes(1);
});

it("checks and refreshes immediately when an updated page becomes hidden", async () => {
    detection.check.mockResolvedValueOnce(null).mockResolvedValueOnce({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));

    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(detection.check).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledTimes(1);
});

it("requires manual recovery after the target was already attempted", async () => {
    sessionStorage.setItem("holycluster_ui_last_auto_target", "/assets/next.js");
    detection.check.mockResolvedValue({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));

    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(navigate).not.toHaveBeenCalled();
    expect(Consumer.refresh.manual_required).toBe(true);
});

it("waits another hour after a blocker clears", async () => {
    detection.check.mockResolvedValue({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    const navigate = vi.fn();
    const view = render(
        <UiRefreshProvider navigate={navigate}>
            <Blocker active={true} />
            <Consumer />
        </UiRefreshProvider>,
    );
    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(navigate).not.toHaveBeenCalled();

    view.rerender(
        <UiRefreshProvider navigate={navigate}>
            <Blocker active={false} />
            <Consumer />
        </UiRefreshProvider>,
    );
    expect(navigate).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(navigate).toHaveBeenCalledTimes(1);
});

it("records a manual navigation marker without consuming the automatic attempt", async () => {
    detection.check.mockResolvedValue({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));

    act(() => Consumer.refresh.manual_reload());
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem("holycluster_ui_navigation"))).toEqual({
        source_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    expect(sessionStorage.getItem("holycluster_ui_last_auto_target")).toBeNull();
});

it("requires storage for automatic navigation but still allows manual reload", async () => {
    detection.check.mockResolvedValue({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("Storage blocked");
    });

    act(() => expect(Consumer.refresh.automatic_reload()).toBe(false));
    expect(navigate).not.toHaveBeenCalled();
    act(() => Consumer.refresh.manual_reload());
    expect(navigate).toHaveBeenCalledTimes(1);
});

it("allows only one automatic navigation for a target", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    detection.check.mockResolvedValue({
        current_entry: "/assets/current.js",
        target_entry: "/assets/next.js",
    });
    const navigate = vi.fn();
    render_provider({ navigate });
    await act(() => vi.advanceTimersByTimeAsync(0));

    act(() => {
        expect(Consumer.refresh.automatic_reload()).toBe(true);
        expect(Consumer.refresh.automatic_reload()).toBe(false);
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("holycluster_ui_last_auto_target")).toBe("/assets/next.js");
});

it("reports and clears a navigation outcome when the transport is ready", async () => {
    sessionStorage.setItem(
        "holycluster_ui_navigation",
        JSON.stringify({
            source_entry: "/assets/old.js",
            target_entry: "/assets/current.js",
        }),
    );
    websocket.current = { readyState: 1, send: websocket.send };
    detection.check.mockResolvedValue(null);
    render(
        <StrictMode>
            <UiRefreshProvider>
                <Consumer />
            </UiRefreshProvider>
        </StrictMode>,
    );
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(websocket.send).toHaveBeenCalledTimes(1);
    expect(websocket.send).toHaveBeenCalledWith("ui_refresh", {
        event: "loaded_target",
        blocker: "none",
    });
    expect(sessionStorage.getItem("holycluster_ui_navigation")).toBeNull();
});

it.each([
    ["/assets/current.js", "target_mismatch"],
    ["/assets/old.js", "loaded_target"],
])("classifies a pending navigation from %s as %s", (source_entry, event) => {
    sessionStorage.setItem(
        "holycluster_ui_navigation",
        JSON.stringify({ source_entry, target_entry: "/assets/next.js" }),
    );
    detection.check.mockResolvedValue(null);
    render_provider();
    expect(Consumer.refresh.navigation_outcome).toEqual({ event, blocker: "none" });
});

it("checks once during Strict Mode setup", async () => {
    detection.check.mockResolvedValue(null);
    render(
        <StrictMode>
            <UiRefreshProvider>
                <Consumer />
            </UiRefreshProvider>
        </StrictMode>,
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(detection.check).toHaveBeenCalledTimes(1);
});

it("checks immediately and once per hour without overlapping checks", async () => {
    let finish_first;
    detection.check
        .mockReturnValueOnce(new Promise(resolve => (finish_first = resolve)))
        .mockResolvedValue(null);

    render_provider();
    expect(detection.check).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(detection.check).toHaveBeenCalledTimes(1);

    await act(async () => finish_first(null));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(detection.check).toHaveBeenCalledTimes(2);
});

it("keeps checking while an update is pending and replaces its target", async () => {
    detection.check
        .mockResolvedValueOnce({
            current_entry: "/assets/current.js",
            target_entry: "/assets/next.js",
        })
        .mockResolvedValueOnce({
            current_entry: "/assets/current.js",
            target_entry: "/assets/newest.js",
        });

    render_provider({ navigate: vi.fn() });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(Consumer.refresh.target_entry).toBe("/assets/next.js");

    await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000));
    expect(Consumer.refresh.target_entry).toBe("/assets/newest.js");
});

it("checks on the online event only after a failed check", async () => {
    detection.check.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(null);
    render_provider();
    await act(() => vi.advanceTimersByTimeAsync(0));

    act(() => window.dispatchEvent(new Event("online")));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(detection.check).toHaveBeenCalledTimes(2);

    act(() => window.dispatchEvent(new Event("online")));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(detection.check).toHaveBeenCalledTimes(2);
});

it("checks immediately when the document becomes hidden", async () => {
    detection.check.mockResolvedValue(null);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    render_provider();
    await act(() => vi.advanceTimersByTimeAsync(0));

    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(detection.check).toHaveBeenCalledTimes(2);
});

it("does not check when navigation makes the document hidden", async () => {
    detection.check.mockResolvedValue(null);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    render_provider();
    await act(() => vi.advanceTimersByTimeAsync(0));

    act(() => window.dispatchEvent(new Event("holycluster:ui-navigation")));
    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(detection.check).toHaveBeenCalledTimes(1);
});

it("performs a fresh hidden check after an older check completes", async () => {
    let finish_first;
    detection.check
        .mockReturnValueOnce(new Promise(resolve => (finish_first = resolve)))
        .mockResolvedValue(null);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    render_provider();

    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(detection.check).toHaveBeenCalledTimes(1);

    await act(async () => finish_first(null));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(detection.check).toHaveBeenCalledTimes(2);
});
