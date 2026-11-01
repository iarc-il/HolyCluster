import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const detection = vi.hoisted(() => ({ check: vi.fn() }));

vi.mock("@/module_load_recovery.js", () => ({ detect_ui_build: detection.check }));

import { UiRefreshProvider, useUiRefresh, useUiRefreshBlocker } from "@/hooks/useUiRefresh.jsx";

function Consumer() {
    Consumer.refresh = useUiRefresh();
    return null;
}

function Blocker({ active, reason = "modal" }) {
    useUiRefreshBlocker(active, reason);
    return null;
}

function render_provider() {
    return render(
        <UiRefreshProvider>
            <Consumer />
        </UiRefreshProvider>,
    );
}

beforeEach(() => {
    vi.useFakeTimers();
    detection.check.mockReset();
    document.head.insertAdjacentHTML(
        "beforeend",
        '<meta name="ui-entry" content="/assets/current.js">',
    );
});

afterEach(() => {
    cleanup();
    document.querySelector('meta[name="ui-entry"]')?.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
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
