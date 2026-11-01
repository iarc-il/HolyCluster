import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    blocker: vi.fn(),
    message_handler: null,
    send: vi.fn(() => true),
}));

vi.mock("@uidotdev/usehooks", () => ({ useLocalStorage: () => [false, vi.fn()] }));
vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({ colors: { buttons: { utility: "blue" }, theme: { text: "black" } } }),
}));
vi.mock("@/hooks/useRadio", () => ({ default: () => ({ radio_freq: 14_000_000 }) }));
vi.mock("@/hooks/useSettings", () => ({
    useSettings: () => ({ settings: { callsign: "N0CALL", theme: "Light" } }),
}));
vi.mock("@/hooks/useUiRefresh.jsx", () => ({ useUiRefreshBlocker: state.blocker }));
vi.mock("@/hooks/useWs", () => ({
    ReadyState: { OPEN: 1, CLOSED: 3 },
    useWs: () => ({ send: state.send, network_state: "connected" }),
    useWsMessage: (_type, handler) => {
        state.message_handler = handler;
    },
}));
vi.mock("@/components/ui/Modal.jsx", () => ({
    default: ({ button, on_open, on_apply, on_cancel, children }) => (
        <div>
            <button type="button" onClick={on_open}>
                {button}
            </button>
            <button type="button" onClick={on_apply}>
                Apply
            </button>
            <button type="button" onClick={on_cancel}>
                Cancel
            </button>
            {children}
        </div>
    ),
}));

import SubmitSpot from "@/components/SubmitSpot.jsx";

beforeEach(() => {
    vi.useFakeTimers();
    state.blocker.mockReset();
    state.send.mockClear();
    state.send.mockReturnValue(true);
    state.message_handler = null;
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

function submit() {
    render(<SubmitSpot dev_mode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit spot" }));
    fireEvent.change(document.querySelector('[data-tour="submit-spot-frequency"]'), {
        target: { value: "14000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
}

it("blocks until a terminal response after the dialog closes", () => {
    submit();
    expect(state.send).toHaveBeenCalledTimes(1);
    expect(state.blocker).toHaveBeenLastCalledWith(true, "submission");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.blocker).toHaveBeenLastCalledWith(true, "submission");

    act(() => state.message_handler({ status: "success" }));
    expect(state.blocker).toHaveBeenLastCalledWith(false, "submission");
});

it("times out after 60 seconds and ignores a late response for blocker state", async () => {
    submit();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(state.blocker).toHaveBeenLastCalledWith(false, "submission");
    expect(document.body.textContent).toContain("The server did not respond");

    act(() => state.message_handler({ status: "failure", error_type: "OtherError" }));
    expect(state.blocker).toHaveBeenLastCalledWith(false, "submission");
});

it("clears the response timer on unmount", () => {
    const set_timeout = vi.spyOn(window, "setTimeout");
    const clear_timeout = vi.spyOn(window, "clearTimeout");
    submit();
    const timer_call = set_timeout.mock.calls.findIndex(([_callback, delay]) => delay === 60_000);
    expect(timer_call).toBeGreaterThanOrEqual(0);
    const timer = set_timeout.mock.results[timer_call].value;

    cleanup();
    expect(clear_timeout).toHaveBeenCalledWith(timer);
});
