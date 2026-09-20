import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const radio = vi.hoisted(() => ({ current: null }));
const rotator = vi.hoisted(() => ({ current: null }));

vi.mock("@/hooks/useRadio", () => ({ default: () => radio.current }));
vi.mock("@/hooks/useRotator", () => ({ default: () => rotator.current }));
vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({
        colors: {
            theme: {
                input_background: "white",
                text: "black",
                disabled_text: "gray",
                borders: "gray",
            },
            buttons: { utility: "black" },
        },
    }),
}));

import CatControl from "@/components/settings/CatControl.jsx";

const network_descriptors = [
    { kind: "text", token: "rig_pathname", label: "Pathname", tooltip: "", default: "" },
];
const serial_descriptors = [
    { kind: "text", token: "rig_pathname", label: "Pathname", tooltip: "", default: "" },
    {
        kind: "integer",
        token: "baud",
        label: "Baud",
        tooltip: "",
        default: 9600,
        minimum: 1200,
        maximum: 115200,
        step: 1200,
    },
];

function render_cat(radio_config_apply_ref = null) {
    return render(
        <CatControl
            temp_settings={{ highlight_enabled: true, highlight_port: 2237 }}
            set_temp_settings={vi.fn()}
            radio_config_apply_ref={radio_config_apply_ref}
        />,
    );
}

describe("CAT control settings", () => {
    beforeEach(() => {
        rotator.current = {
            rotator_models: [],
            rotator_model_details: {},
            rotator_configuration: null,
            rotator_configuration_result: null,
            rotator_connection_result: null,
            list_rotator_models: vi.fn(),
            describe_rotator_model: vi.fn(),
            get_rotator_configuration: vi.fn(),
            apply_rotator_configuration: vi.fn(() => Promise.resolve({ ok: true })),
            test_rotator_connection: vi.fn(),
        };
        radio.current = {
            radio_capabilities: { radio_configuration_api: 2, rotator_configuration: false },
            radio_configuration_support: "supported",
            radio_configuration: {
                event: "configuration",
                rig: {
                    model_id: "hamlib:4",
                    token_values: { rig_pathname: "127.0.0.1:4532" },
                },
            },
            radio_configuration_result: null,
            radio_connection_result: null,
            radio_models: [
                {
                    id: "hamlib:2",
                    manufacturer: "Acme",
                    model: "Serial Rig",
                    connection_kind: "serial",
                },
                {
                    id: "hamlib:4",
                    manufacturer: "Hamlib",
                    model: "NET rigctl",
                    connection_kind: "network",
                },
                {
                    id: "omnirig:1",
                    manufacturer: "OmniRig",
                    model: "OmniRig Rig 1",
                    connection_kind: "none",
                },
                {
                    id: "omnirig:2",
                    manufacturer: "OmniRig",
                    model: "OmniRig Rig 2",
                    connection_kind: "none",
                },
            ],
            radio_models_error: null,
            serial_ports: ["/dev/ttyACM0", "/dev/ttyUSB0"],
            serial_ports_error: null,
            radio_model_details: {
                "hamlib:2": serial_descriptors,
                "hamlib:4": network_descriptors,
                "omnirig:1": [],
                "omnirig:2": [],
            },
            radio_model_error: null,
            get_radio_configuration: vi.fn(),
            list_radio_models: vi.fn(),
            list_serial_ports: vi.fn(),
            describe_radio_model: vi.fn(),
            set_radio_configuration: vi.fn(() => Promise.resolve({ ok: true, errors: [] })),
            test_radio_connection: vi.fn(),
        };
    });

    afterEach(() => cleanup());

    it("shows one unified model selector without rig or backend controls", () => {
        render_cat();

        expect(screen.getByRole("combobox", { name: "Model" })).not.toBeNull();
        expect(screen.queryByLabelText("Rig")).toBeNull();
        expect(screen.queryByLabelText("Backend")).toBeNull();
        expect(screen.queryByLabelText("Enable Rig 2")).toBeNull();
        expect(radio.current.list_radio_models).toHaveBeenCalled();
    });

    it("serializes generic network configuration for apply and test", async () => {
        const user = userEvent.setup();
        const apply_ref = { current: null };
        render_cat(apply_ref);

        await user.clear(screen.getByLabelText("Host"));
        await user.type(screen.getByLabelText("Host"), "radio.local");
        await user.clear(screen.getByLabelText("Port"));
        await user.type(screen.getByLabelText("Port"), "5000");
        await user.click(screen.getByRole("button", { name: "Test connection" }));

        const expected = {
            rig: {
                model_id: "hamlib:4",
                token_values: { rig_pathname: "radio.local:5000" },
            },
        };
        expect(radio.current.test_radio_connection).toHaveBeenCalledWith(expected);
        await expect(apply_ref.current()).resolves.toBe(true);
        expect(radio.current.set_radio_configuration).toHaveBeenCalledWith(expected);
    });

    it.each(["omnirig:1", "omnirig:2"])("renders %s without connection fields", async model_id => {
        const user = userEvent.setup();
        render_cat();
        const model = screen.getByRole("combobox", { name: "Model" });
        await user.clear(model);
        await user.type(model, model_id);
        await user.click(screen.getByRole("option", { name: /OmniRig Rig/ }));

        expect(screen.queryByLabelText("Host")).toBeNull();
        expect(screen.queryByLabelText("Port")).toBeNull();
        expect(screen.queryByLabelText("Serial port")).toBeNull();
    });

    it("preserves connection tokens while model metadata is unavailable", async () => {
        radio.current.radio_models = [];
        radio.current.radio_model_details = {};
        const apply_ref = { current: null };
        render_cat(apply_ref);

        await apply_ref.current();
        expect(radio.current.set_radio_configuration).toHaveBeenCalledWith({
            rig: {
                model_id: "hamlib:4",
                token_values: { rig_pathname: "127.0.0.1:4532" },
            },
        });
    });

    it("keeps an unconfigured server unconfigured until a model is selected", async () => {
        radio.current.radio_configuration = { event: "configuration", rig: null };
        const apply_ref = { current: null };
        render_cat(apply_ref);

        expect(screen.getByRole("combobox", { name: "Model" }).value).toBe("");
        await apply_ref.current();
        expect(radio.current.set_radio_configuration).toHaveBeenCalledWith({ rig: null });
    });

    it("shows update-required state by hiding unsupported radio controls", () => {
        radio.current.radio_configuration_support = "update_required";
        render_cat();

        expect(screen.queryByRole("region", { name: "Radio hardware settings" })).toBeNull();
        expect(
            screen.getByText("Update the CAT server to configure radio hardware."),
        ).not.toBeNull();
        expect(screen.getByText("Logger integration")).not.toBeNull();
    });
});
