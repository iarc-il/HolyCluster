import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const websocket = vi.hoisted(() => ({
    ReadyState: { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 },
    ready_state: 1,
    transport: "unified",
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
    useWs: () => ({
        send: websocket.send,
        radioReadyState: websocket.ready_state,
        transport: websocket.transport,
    }),
    useWsMessage: (type, handler) => websocket.subscribe(type, handler),
}));

import useRadio, { RadioProvider } from "@/hooks/useRadio";
import { RTTY_TUNING_MIN_VERSION } from "@/utils/cat_features.js";

function Consumer() {
    Consumer.radio = useRadio();
    return null;
}

function emit(message) {
    act(() => websocket.handlers.get("radio")(message));
}

function render_radio() {
    return render(
        <RadioProvider>
            <Consumer />
        </RadioProvider>,
    );
}

describe("radio configuration", () => {
    beforeEach(() => {
        websocket.ready_state = websocket.ReadyState.OPEN;
        websocket.transport = "unified";
        websocket.handlers.clear();
        websocket.send.mockClear();
        Consumer.radio = null;
    });

    afterEach(() => cleanup());

    it("uses radio configuration API 2 protocol messages", async () => {
        render_radio();
        const config = {
            rig: { model_id: "hamlib:2", token_values: { rig_pathname: "/dev/ttyUSB0" } },
        };

        act(() => {
            Consumer.radio.list_radio_models();
            Consumer.radio.describe_radio_model("hamlib:2");
            Consumer.radio.get_radio_configuration();
            void Consumer.radio.set_radio_configuration(config);
        });

        expect(websocket.send).toHaveBeenNthCalledWith(1, "radio", { action: "ListRadioModels" });
        expect(websocket.send).toHaveBeenNthCalledWith(2, "radio", {
            action: "DescribeRadioModel",
            model_id: "hamlib:2",
        });
        expect(websocket.send).toHaveBeenNthCalledWith(3, "radio", {
            action: "GetRadioConfiguration",
        });
        expect(websocket.send).toHaveBeenNthCalledWith(4, "radio", {
            action: "SetRadioConfiguration",
            configuration: config,
        });

        emit({ event: "radio_models", models: [{ id: "hamlib:2", model: "Dummy" }] });
        emit({ event: "radio_model", model_id: "hamlib:1", descriptors: [{ token: "stale" }] });
        expect(Consumer.radio.radio_model_detail).toBeNull();
        emit({ event: "radio_model", model_id: "hamlib:2", descriptors: [{ token: "path" }] });
        emit({ event: "configuration_result", ok: true });

        expect(Consumer.radio.radio_models).toEqual([{ id: "hamlib:2", model: "Dummy" }]);
        expect(Consumer.radio.radio_model_detail).toEqual([{ token: "path" }]);
        expect(Consumer.radio.radio_configuration).toEqual({ event: "configuration", ...config });
    });

    it("negotiates capabilities and reports unsupported transports", () => {
        const view = render_radio();
        emit({ event: "status", status: "connected", catserver_version: "catserver-v2.0.0" });
        expect(websocket.send).toHaveBeenCalledWith("radio", { action: "GetCapabilities" });
        emit({ event: "capabilities", radio_configuration_api: 2 });
        expect(Consumer.radio.radio_configuration_support).toBe("supported");

        websocket.transport = "cat_v1_2";
        view.rerender(
            <RadioProvider>
                <Consumer />
            </RadioProvider>,
        );
        expect(Consumer.radio.radio_configuration_support).toBe("update_required");
    });

    it("keeps migration acknowledgements separate from configuration results", async () => {
        render_radio();
        let migration_result;
        await act(async () => {
            void Consumer.radio
                .migrate_omnirig_selection(2)
                .then(result => (migration_result = result));
        });
        expect(websocket.send).toHaveBeenCalledWith("radio", {
            action: "MigrateOmniRigSelection",
            rig: 2,
        });

        emit({ event: "configuration_result", ok: true });
        expect(migration_result).toBeUndefined();
        await act(async () => {
            emit({
                event: "omnirig_selection_migration_result",
                ok: true,
                migrated: true,
                effective_model_id: "omnirig:2",
            });
        });
        expect(migration_result.effective_model_id).toBe("omnirig:2");
    });

    it("continues tuning without active-rig state", () => {
        render_radio();
        const supported_version = `catserver-v${RTTY_TUNING_MIN_VERSION.slice(0, 3).join(".")}`;
        emit({
            event: "status",
            status: "connected",
            freq: 14_074_000,
            catserver_version: supported_version,
        });
        act(() => Consumer.radio.set_mode_and_freq("RTTY", 14.1));

        expect(Consumer.radio.radio_band).toBe(20);
        expect(websocket.send).toHaveBeenCalledWith("radio", {
            action: "SetModeAndFreq",
            mode: "RTTY",
            freq: 14.1,
        });
        expect(Consumer.radio.set_rig).toBeUndefined();
    });
});
