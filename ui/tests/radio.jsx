import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const websocket = vi.hoisted(() => ({
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
    useWs: () => ({ send: websocket.send }),
    useWsMessage: (type, handler) => {
        websocket.subscribe(type, handler);
    },
}));

import useRadio, { RadioProvider } from "@/hooks/useRadio";

function Consumer() {
    Consumer.radio = useRadio();
    return null;
}

function emit(message) {
    act(() => websocket.handlers.get("radio")(message));
}

describe("radio configuration", () => {
    beforeEach(() => {
        websocket.handlers.clear();
        websocket.send.mockClear();
        Consumer.radio = null;
        render(
            <RadioProvider>
                <Consumer />
            </RadioProvider>,
        );
    });

    afterEach(() => cleanup());

    it("tracks unified configuration responses and sends configuration actions", () => {
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
        emit({ event: "capabilities", radio_configuration: true, backends: ["hamlib"] });
        emit({ event: "hamlib_models", models: [{ id: "2", model: "Dummy" }] });
        emit({ event: "hamlib_model", model_id: "1", descriptors: [{ token: "stale" }] });
        expect(Consumer.radio.hamlib_model_detail).toBeNull();
        emit({ event: "hamlib_model", model_id: "2", descriptors: [{ token: "path" }] });
        emit({ event: "configuration", backend: "hamlib", hamlib: { rig1: { model_id: "2" } } });
        emit({ event: "configuration_result", ok: true });

        act(() => Consumer.radio.retry_radio());
        expect(websocket.send).toHaveBeenNthCalledWith(6, "radio", { action: "RetryRadio" });
        emit({ event: "configuration_result", ok: true });
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
});
