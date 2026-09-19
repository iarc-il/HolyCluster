import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const websocket = vi.hoisted(() => ({
    ReadyState: { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 },
    ready_state: 1,
    handlers: new Map(),
    send: vi.fn(),
    subscribe: vi.fn((type, handler) => {
        websocket.handlers.set(type, handler);
        return () => websocket.handlers.delete(type);
    }),
}));

vi.mock("@/hooks/useSettings", () => ({
    useSettings: () => ({ settings: { callsign: "N0CALL" } }),
}));

vi.mock("@/hooks/useWs", () => ({
    ReadyState: websocket.ReadyState,
    useWs: () => ({ send: websocket.send, readyState: websocket.ready_state }),
    useWsMessage: (type, handler) => {
        websocket.subscribe(type, handler);
    },
}));

import useRadio, { RadioProvider } from "@/hooks/useRadio";
import { RTTY_TUNING_MIN_VERSION } from "@/utils/cat_features.js";

function Consumer() {
    Consumer.radio = useRadio();
    return null;
}

let rerender_radio;

function emit(message) {
    act(() => websocket.handlers.get("radio")(message));
}

describe("radio configuration", () => {
    beforeEach(() => {
        websocket.ready_state = websocket.ReadyState.OPEN;
        websocket.handlers.clear();
        websocket.send.mockClear();
        Consumer.radio = null;
        rerender_radio = render(
            <RadioProvider>
                <Consumer />
            </RadioProvider>,
        ).rerender;
    });

    afterEach(() => cleanup());

    it("tracks unified configuration responses and sends configuration actions", async () => {
        const radio = Consumer.radio;

        act(() => {
            radio.get_radio_capabilities();
            radio.list_hamlib_models();
            radio.describe_hamlib_model("2");
            radio.get_radio_configuration();
            radio.set_radio_configuration({ backend: "hamlib" });
        });

        expect(websocket.send).toHaveBeenNthCalledWith(1, "radio", { action: "GetCapabilities" });
        expect(websocket.send).toHaveBeenNthCalledWith(2, "radio", {
            action: "ListHamlibModels",
        });
        expect(websocket.send).toHaveBeenNthCalledWith(3, "radio", {
            action: "DescribeHamlibModel",
            model_id: "2",
        });
        expect(websocket.send).toHaveBeenNthCalledWith(4, "radio", {
            action: "GetRadioConfiguration",
        });
        expect(websocket.send).toHaveBeenNthCalledWith(5, "radio", {
            action: "SetRadioConfiguration",
            configuration: { backend: "hamlib" },
        });
        emit({ event: "status", status: "connected" });
        emit({ event: "capabilities", radio_configuration: true, backends: ["hamlib"] });
        emit({ event: "hamlib_models", models: [{ id: "2", model: "Dummy" }] });
        emit({ event: "hamlib_model", model_id: "1", descriptors: [{ token: "stale" }] });
        expect(Consumer.radio.hamlib_model_detail).toBeNull();
        emit({ event: "hamlib_model", model_id: "2", descriptors: [{ token: "path" }] });
        await act(async () => {
            emit({ event: "configuration_result", ok: true });
        });
        emit({ event: "configuration", backend: "hamlib", hamlib: { rig1: { model_id: "2" } } });

        act(() => Consumer.radio.retry_radio());
        expect(websocket.send).toHaveBeenNthCalledWith(6, "radio", { action: "RetryRadio" });
        await act(async () => {
            emit({ event: "configuration_result", ok: true });
        });
        emit({ event: "retry", ok: true });

        expect(Consumer.radio.radio_capabilities).toEqual({
            event: "capabilities",
            radio_configuration: true,
            backends: ["hamlib"],
        });
        expect(Consumer.radio.hamlib_models).toEqual([{ id: "2", model: "Dummy" }]);
        expect(Consumer.radio.hamlib_model_detail).toEqual([{ token: "path" }]);
        expect(Consumer.radio.radio_configuration).toEqual({
            event: "configuration",
            backend: "hamlib",
            hamlib: { rig1: { model_id: "2" } },
        });
        expect(Consumer.radio.radio_configuration_result).toEqual({
            event: "configuration_result",
            ok: true,
        });
        expect(Consumer.radio.radio_retry_result).toEqual({ event: "retry", ok: true });
    });

    it("clears capabilities until a fresh response after reconnect or CAT change", () => {
        const supported_version = `catserver-v${RTTY_TUNING_MIN_VERSION.slice(0, 3).join(".")}`;

        emit({ event: "status", status: "connected", catserver_version: supported_version });
        emit({ event: "capabilities", radio_configuration: true, backends: ["hamlib"] });
        expect(Consumer.radio.radio_capabilities?.radio_configuration).toBe(true);

        websocket.ready_state = websocket.ReadyState.CLOSED;
        act(() => {
            rerender_radio(
                <RadioProvider>
                    <Consumer />
                </RadioProvider>,
            );
        });
        expect(Consumer.radio.radio_capabilities).toBeNull();

        websocket.ready_state = websocket.ReadyState.OPEN;
        act(() => {
            rerender_radio(
                <RadioProvider>
                    <Consumer />
                </RadioProvider>,
            );
        });
        emit({ event: "status", status: "disconnected" });
        expect(Consumer.radio.radio_capabilities).toBeNull();
        emit({ event: "capabilities", radio_configuration: true, backends: ["hamlib"] });
        expect(Consumer.radio.radio_capabilities).toBeNull();

        emit({ event: "status", status: "connected", catserver_version: supported_version });
        expect(Consumer.radio.radio_capabilities).toBeNull();
        emit({ event: "capabilities", radio_configuration: true, backends: ["hamlib"] });
        expect(Consumer.radio.radio_capabilities?.radio_configuration).toBe(true);

        emit({ event: "status", status: "connected", catserver_version: "catserver-v9.0.0" });
        expect(Consumer.radio.radio_capabilities).toBeNull();
    });

    it("sends RTTY tuning for a CAT version that supports it", () => {
        const supported_version = `catserver-v${RTTY_TUNING_MIN_VERSION.slice(0, 3).join(".")}`;
        emit({ event: "status", status: "connected", catserver_version: supported_version });

        act(() => Consumer.radio.set_mode_and_freq("RTTY", 14.1));

        expect(websocket.send).toHaveBeenLastCalledWith("radio", {
            action: "SetModeAndFreq",
            mode: "RTTY",
            freq: 14.1,
        });
    });

    it("updates the cached config after a successful apply", () => {
        const radio = Consumer.radio;
        const config = { backend: "hamlib" };

        act(() => {
            void radio.set_radio_configuration(config);
        });
        emit({ event: "configuration_result", ok: true });

        expect(Consumer.radio.radio_configuration).toEqual({
            event: "configuration",
            ...config,
        });
    });

    it("sends a draft to the connection test action", async () => {
        const radio = Consumer.radio;
        const config = { backend: "hamlib" };

        await act(async () => {
            radio.test_radio_connection(config);
        });

        expect(websocket.send).toHaveBeenCalledWith("radio", {
            action: "TestRadioConnection",
            config,
        });
        emit({ event: "radio_connection_result", ok: true });
        expect(Consumer.radio.radio_connection_result).toEqual({
            event: "radio_connection_result",
            ok: true,
        });
    });
});
