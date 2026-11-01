import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const detection = vi.hoisted(() => ({ check: vi.fn() }));
const websocket = vi.hoisted(() => ({ current: null, send: vi.fn() }));

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

    render_provider();
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
