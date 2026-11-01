import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    network_state: "connected",
    local_version: [1, 3, 0, 0],
    radio_capabilities: { rotator_stop: true },
    handler: null,
    send: vi.fn(),
    start_blocker: vi.fn(),
    finish_blocker: vi.fn(),
    warn: vi.fn(),
}));

vi.mock("@/hooks/useRadio", () => ({
    default: () => ({
        local_version: state.local_version,
        radio_capabilities: state.radio_capabilities,
    }),
}));
vi.mock("react-toastify", () => ({
    toast: { warn: state.warn },
}));
vi.mock("@/hooks/useUiRefresh.jsx", () => ({
    useUiRefreshGraceBlocker: () => ({
        start: state.start_blocker,
        finish: state.finish_blocker,
    }),
}));
vi.mock("@/hooks/useWs", () => ({
    useWs: () => ({ network_state: state.network_state, send: state.send }),
    useWsMessage: (_type, handler) => {
        state.handler = handler;
    },
}));

import useRotator, { RotatorProvider } from "@/hooks/useRotator";

function Consumer() {
    Consumer.rotator = useRotator();
    return null;
}

function App() {
    return (
        <RotatorProvider>
            <Consumer />
        </RotatorProvider>
    );
}

function status(status, azimuth) {
    act(() => state.handler({ event: "status", status, azimuth }));
}

describe("rotator map bearings", () => {
    beforeEach(() => {
        state.network_state = "connected";
        state.local_version = [1, 3, 0, 0];
        state.radio_capabilities = { rotator_stop: true };
        state.send.mockClear();
        state.send.mockReturnValue(true);
        state.start_blocker.mockClear();
        state.finish_blocker.mockClear();
        state.warn.mockClear();
    });
    afterEach(cleanup);

    it("hides the unconfigured default bearing but shows a connected north bearing", () => {
        render(<App />);
        expect(Consumer.rotator.rotator_azimuth).toBeNull();
        status("disconnected", 0);
        expect(Consumer.rotator.rotator_azimuth).toBeNull();
        status("connected", 0);
        expect(Consumer.rotator.rotator_azimuth).toBe(0);
    });

    it("keeps the last movement visible when the rotator disconnects", () => {
        render(<App />);
        status("connected", 90);
        act(() => Consumer.rotator.set_azimuth(180));
        expect(state.start_blocker).toHaveBeenCalledWith("movement");
        expect(Consumer.rotator.rotator_azimuth).toBe(90);
        expect(Consumer.rotator.rotator_target_azimuth).toBe(180);
        status("disconnected", 90);
        expect(state.finish_blocker).not.toHaveBeenCalledWith("movement");
        expect(Consumer.rotator.rotator_heading).toBe(90);
        expect(Consumer.rotator.rotator_target_azimuth).toBe(180);
        status("connected", 179);
        expect(state.finish_blocker).toHaveBeenCalledWith("movement");
    });

    it("does not restore stale bearings on socket reconnection", () => {
        const view = render(<App />);
        status("connected", 90);
        act(() => Consumer.rotator.set_azimuth(180));
        state.network_state = "disconnected";
        view.rerender(<App />);
        expect(Consumer.rotator.rotator_azimuth).toBeNull();
        expect(Consumer.rotator.rotator_target_azimuth).toBeNull();
        state.network_state = "connected";
        view.rerender(<App />);
        expect(Consumer.rotator.rotator_azimuth).toBeNull();
        expect(Consumer.rotator.rotator_target_azimuth).toBeNull();
        status("connected", 120);
        expect(Consumer.rotator.rotator_azimuth).toBe(120);
    });

    it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, "90"])(
        "hides invalid connected bearing %s",
        azimuth => {
            render(<App />);
            status("connected", azimuth);
            expect(Consumer.rotator.rotator_azimuth).toBeNull();
        },
    );

    it("keeps movement visible until stopping succeeds", () => {
        render(<App />);
        status("connected", 90);
        act(() => Consumer.rotator.set_azimuth(180));
        state.send.mockClear();

        act(() => Consumer.rotator.toggle_rotator_tuning());

        expect(Consumer.rotator.rotator_tuning_enabled).toBe(false);
        expect(Consumer.rotator.rotator_heading).toBe(90);
        expect(Consumer.rotator.rotator_azimuth).toBe(90);
        expect(Consumer.rotator.rotator_target_azimuth).toBe(180);
        expect(state.send).toHaveBeenCalledWith("rotator", { action: "Stop" });
        expect(state.start_blocker).toHaveBeenLastCalledWith("stop");

        act(() => state.handler({ event: "command_result", action: "Stop", ok: true }));
        expect(state.finish_blocker).toHaveBeenCalledWith("stop");
        expect(Consumer.rotator.rotator_target_azimuth).toBeNull();
    });

    it("keeps movement visible and warns when stopping fails", () => {
        render(<App />);
        status("connected", 90);
        act(() => Consumer.rotator.set_azimuth(180));
        act(() => Consumer.rotator.toggle_rotator_tuning());

        act(() => state.handler({ event: "command_result", action: "Stop", ok: false }));
        expect(Consumer.rotator.rotator_target_azimuth).toBe(180);
        status("disconnected", 0);

        expect(Consumer.rotator.rotator_heading).toBe(90);
        expect(Consumer.rotator.rotator_target_azimuth).toBe(180);
        expect(state.warn).toHaveBeenCalledWith("The rotator could not be stopped.", {
            toastId: "rotator-stop",
        });
    });

    it("keeps movement visible when the CATServer cannot stop rotators", () => {
        state.radio_capabilities = { rotator_stop: false };
        render(<App />);
        status("connected", 90);
        act(() => Consumer.rotator.set_azimuth(180));
        state.send.mockClear();

        act(() => Consumer.rotator.toggle_rotator_tuning());

        expect(Consumer.rotator.rotator_target_azimuth).toBe(180);
        expect(Consumer.rotator.rotator_azimuth).toBe(90);
        expect(state.send).not.toHaveBeenCalled();
        expect(state.warn).toHaveBeenCalledWith(
            "This CATServer cannot stop movement already in progress.",
            { toastId: "rotator-stop" },
        );
    });

    it("does not tune while disabled and resumes tuning when enabled", () => {
        render(<App />);
        status("connected", 90);
        act(() => Consumer.rotator.toggle_rotator_tuning());
        state.send.mockClear();

        act(() => Consumer.rotator.set_azimuth(180));
        expect(state.send).not.toHaveBeenCalled();

        act(() => Consumer.rotator.toggle_rotator_tuning());
        act(() => Consumer.rotator.set_azimuth(180));
        expect(state.send).toHaveBeenCalledWith("rotator", {
            action: "SetAzimuth",
            azimuth: 180,
        });
    });

    it("does not replace an in-flight configuration operation", async () => {
        render(<App />);
        let first;
        let second;
        act(() => {
            first = Consumer.rotator.apply_rotator_configuration({ backend: "first" });
            second = Consumer.rotator.apply_rotator_configuration({ backend: "second" });
        });
        await expect(second).resolves.toMatchObject({ ok: false });
        expect(state.send).toHaveBeenCalledTimes(1);

        act(() => state.handler({ event: "rotator_configuration_result", ok: true }));
        await expect(first).resolves.toMatchObject({ ok: true });
    });

    it("blocks configuration, connection tests, and retries until their results", async () => {
        render(<App />);
        let apply;
        act(() => {
            apply = Consumer.rotator.apply_rotator_configuration({ backend: "unconfigured" });
        });
        expect(state.start_blocker).toHaveBeenLastCalledWith("configuration");
        act(() => state.handler({ event: "rotator_configuration_result", ok: true }));
        await expect(apply).resolves.toMatchObject({ ok: true });
        expect(state.finish_blocker).toHaveBeenLastCalledWith("configuration");

        act(() => Consumer.rotator.test_rotator_connection({ backend: "unconfigured" }));
        expect(state.start_blocker).toHaveBeenLastCalledWith("connection");
        act(() => state.handler({ event: "rotator_connection_result", ok: true }));
        expect(state.finish_blocker).toHaveBeenLastCalledWith("connection");

        act(() => Consumer.rotator.retry_rotator());
        expect(state.start_blocker).toHaveBeenLastCalledWith("retry");
        status("connected", 90);
        expect(state.finish_blocker).toHaveBeenLastCalledWith("retry");
    });

    it("hides bearings for unsupported CAT versions", () => {
        state.local_version = [1, 2, 0, 0];
        render(<App />);
        status("connected", 90);
        expect(Consumer.rotator.rotator_azimuth).toBeNull();
    });
});
