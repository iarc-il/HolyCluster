import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    network_state: "connected",
    local_version: [1, 3, 0, 0],
    handler: null,
    send: vi.fn(),
}));

vi.mock("@/hooks/useRadio", () => ({
    default: () => ({ local_version: state.local_version }),
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
        state.send.mockClear();
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

    it("clears current and target bearings when the rotator disconnects", () => {
        render(<App />);
        status("connected", 90);
        act(() => Consumer.rotator.set_azimuth(180));
        expect(Consumer.rotator.rotator_azimuth).toBe(90);
        expect(Consumer.rotator.rotator_target_azimuth).toBe(180);
        status("disconnected", 90);
        expect(Consumer.rotator.rotator_azimuth).toBeNull();
        expect(Consumer.rotator.rotator_target_azimuth).toBeNull();
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

    it("hides bearings for unsupported CAT versions", () => {
        state.local_version = [1, 2, 0, 0];
        render(<App />);
        status("connected", 90);
        expect(Consumer.rotator.rotator_azimuth).toBeNull();
    });
});
