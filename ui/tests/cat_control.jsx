import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const radio = vi.hoisted(() => ({ current: null }));

vi.mock("@/hooks/useRadio", () => ({ default: () => radio.current }));
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

const colors = { theme: { text: "black" } };
const descriptors = [
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
    {
        kind: "integer",
        token: "data_bits",
        label: "Data bits",
        tooltip: "",
        default: 8,
        minimum: 5,
        maximum: 8,
        step: 1,
    },
    {
        kind: "integer",
        token: "stop_bits",
        label: "Stop bits",
        tooltip: "",
        default: 1,
        minimum: 1,
        maximum: 2,
        step: 1,
    },
    {
        kind: "combo",
        token: "serial_handshake",
        label: "Handshake",
        tooltip: "",
        default: "None",
        options: ["None", "Hardware"],
    },
    { kind: "text", token: "unsupported", label: "Unsupported", tooltip: "", default: "" },
];
const network_descriptors = [
    { kind: "text", token: "rig_pathname", label: "Pathname", tooltip: "", default: "" },
];

function configuration(
    rig1 = { backend: "rigctld", rigctld: { host: "127.0.0.1", port: 4532 } },
    rig2 = undefined,
) {
    return { event: "configuration", rig1, ...(rig2 ? { rig2 } : {}) };
}

function render_cat(radio_config_apply_ref = null) {
    return render(
        <CatControl
            temp_settings={{ highlight_enabled: true, highlight_port: 2237 }}
            set_temp_settings={vi.fn()}
            colors={colors}
            radio_config_apply_ref={radio_config_apply_ref}
        />,
    );
}

describe("CAT control settings", () => {
    beforeEach(() => {
        radio.current = {
            radio_capabilities: { radio_configuration: true, backends: ["rigctld", "hamlib"] },
            radio_configuration: configuration(),
            radio_configuration_result: null,
            radio_connection_result: null,
            hamlib_models: [
                { id: "1", manufacturer: "Hamlib", model: "Dummy", port_type: "none" },
                { id: "2", manufacturer: "Acme", model: "Rig" },
                { id: "3", manufacturer: "Other", model: "Radio" },
                { id: "4", manufacturer: "Hamlib", model: "NET rigctl", port_type: "network" },
            ],
            hamlib_models_error: null,
            serial_ports: ["/dev/ttyACM0", "/dev/ttyUSB0"],
            serial_ports_error: null,
            hamlib_model_details: { 2: descriptors, 4: network_descriptors },
            hamlib_model_error: null,
            get_radio_configuration: vi.fn(),
            list_hamlib_models: vi.fn(),
            list_serial_ports: vi.fn(),
            describe_hamlib_model: vi.fn(),
            set_radio_configuration: vi.fn(() => Promise.resolve({ ok: true, errors: [] })),
            test_radio_connection: vi.fn(),
        };
    });
    afterEach(() => cleanup());

    it("always provides a native Rig 1 and Rig 2 selector", () => {
        render_cat();
        expect(screen.getByLabelText("Rig").tagName).toBe("SELECT");
        expect(screen.getByRole("option", { name: "Rig 1" })).not.toBeNull();
        expect(screen.getByRole("option", { name: "Rig 2" })).not.toBeNull();
    });

    it("prompts first-run users to choose a backend", () => {
        radio.current.radio_configuration = configuration({ backend: "unconfigured" });
        render_cat();

        expect(screen.getByLabelText("Backend").value).toBe("unconfigured");
        expect(screen.getByRole("option", { name: "Choose a backend" }).disabled).toBe(true);
    });

    it("searches and selects Hamlib models while preserving independent rig drafts", async () => {
        const user = userEvent.setup();
        render_cat();
        await user.clear(screen.getByLabelText("Host"));
        await user.type(screen.getByLabelText("Host"), "rig-one");
        await user.selectOptions(screen.getByLabelText("Rig"), "rig2");
        await user.click(screen.getByLabelText("Enable Rig 2"));
        await user.selectOptions(screen.getByLabelText("Backend"), "hamlib");
        const model = screen.getByRole("combobox", { name: "Model" });
        await user.type(model, "Acme");
        expect(screen.getByRole("option", { name: "Acme Rig" })).not.toBeNull();
        expect(screen.queryByRole("option", { name: "Other Radio" })).toBeNull();
        await user.click(screen.getByRole("option", { name: "Acme Rig" }));
        const serial_port = screen.getByRole("combobox", { name: "Serial port" });
        await user.type(serial_port, "ttyACM");
        expect(screen.getByRole("option", { name: "/dev/ttyACM0" })).not.toBeNull();
        expect(screen.queryByRole("option", { name: "/dev/ttyUSB0" })).toBeNull();
        await user.click(screen.getByRole("option", { name: "/dev/ttyACM0" }));
        expect(screen.getByLabelText("Baud rate").tagName).toBe("SELECT");
        expect(screen.getByLabelText("Data bits").tagName).toBe("SELECT");
        expect(screen.getByLabelText("Stop bits").tagName).toBe("SELECT");
        expect(screen.getByLabelText("Handshake").tagName).toBe("SELECT");
        expect(screen.queryByLabelText("Unsupported")).toBeNull();
        await user.selectOptions(screen.getByLabelText("Rig"), "rig1");
        expect(screen.getByLabelText("Host").value).toBe("rig-one");
        await user.selectOptions(screen.getByLabelText("Rig"), "rig2");
        expect(screen.getByText("Acme Rig")).not.toBeNull();
    });

    it("registers radio config for the settings modal Apply button", async () => {
        const radio_config_apply_ref = { current: null };
        render_cat(radio_config_apply_ref);

        expect(screen.queryByRole("button", { name: "Save radio hardware" })).toBeNull();
        await expect(radio_config_apply_ref.current()).resolves.toBe(true);
        expect(radio.current.set_radio_configuration).toHaveBeenCalledWith({
            rig1: { backend: "rigctld", rigctld: { host: "127.0.0.1", port: 4532 } },
        });
    });

    it("tests the current radio draft without applying it", async () => {
        const user = userEvent.setup();
        render_cat();

        const button = screen.getByRole("button", { name: "Test connection" });
        await user.click(button);

        expect(button.className).toContain("text-xs");
        expect(screen.getByRole("status").textContent).toContain("Testing radio connection...");
        expect(radio.current.test_radio_connection).toHaveBeenCalledWith({
            rig1: { backend: "rigctld", rigctld: { host: "127.0.0.1", port: 4532 } },
        });
        expect(radio.current.set_radio_configuration).not.toHaveBeenCalled();
    });

    it("materializes valid serial defaults for a Hamlib model", async () => {
        const user = userEvent.setup();
        const radio_config_apply_ref = { current: null };
        render_cat(radio_config_apply_ref);

        await user.selectOptions(screen.getByLabelText("Rig"), "rig2");
        await user.click(screen.getByLabelText("Enable Rig 2"));
        await user.selectOptions(screen.getByLabelText("Backend"), "hamlib");
        await user.click(screen.getByRole("combobox", { name: "Model" }));
        await user.click(screen.getByRole("option", { name: "Acme Rig" }));
        expect(screen.getByText("/dev/ttyUSB0")).not.toBeNull();
        await radio_config_apply_ref.current();

        expect(radio.current.set_radio_configuration).toHaveBeenCalledWith({
            rig1: { backend: "rigctld", rigctld: { host: "127.0.0.1", port: 4532 } },
            rig2: {
                backend: "hamlib",
                hamlib: {
                    model_id: "2",
                    token_values: {
                        rig_pathname: "/dev/ttyUSB0",
                        baud: "9600",
                        data_bits: "8",
                        stop_bits: "1",
                        serial_handshake: "None",
                    },
                },
            },
        });
    });

    it("renders and serializes network fields for a network Hamlib model", async () => {
        const user = userEvent.setup();
        const radio_config_apply_ref = { current: null };
        render_cat(radio_config_apply_ref);

        await user.selectOptions(screen.getByLabelText("Backend"), "hamlib");
        await user.click(screen.getByRole("combobox", { name: "Model" }));
        await user.click(screen.getByRole("option", { name: "Hamlib NET rigctl" }));

        expect(screen.getByRole("heading", { name: "Network connection" })).not.toBeNull();
        expect(screen.getByLabelText("Host").value).toBe("127.0.0.1");
        expect(screen.getByLabelText("Port").value).toBe("4532");
        expect(screen.queryByLabelText("Serial port")).toBeNull();

        await user.clear(screen.getByLabelText("Host"));
        await user.type(screen.getByLabelText("Host"), "radio.example");
        await user.clear(screen.getByLabelText("Port"));
        await user.type(screen.getByLabelText("Port"), "4533");
        await radio_config_apply_ref.current();

        expect(radio.current.set_radio_configuration).toHaveBeenCalledWith({
            rig1: {
                backend: "hamlib",
                hamlib: {
                    model_id: "4",
                    token_values: { rig_pathname: "radio.example:4533" },
                },
            },
        });
    });

    it("does not add a serial pathname to a no-port Hamlib model", async () => {
        const user = userEvent.setup();
        const radio_config_apply_ref = { current: null };
        render_cat(radio_config_apply_ref);

        await user.selectOptions(screen.getByLabelText("Backend"), "hamlib");
        expect(screen.queryByLabelText("Serial port")).toBeNull();
        await radio_config_apply_ref.current();

        expect(radio.current.set_radio_configuration).toHaveBeenCalledWith({
            rig1: {
                backend: "hamlib",
                hamlib: { model_id: "1", token_values: {} },
            },
        });
    });

    it("shows a green success indicator for a connection test", () => {
        radio.current.radio_connection_result = { ok: true };
        render_cat();

        const status = screen.getByRole("status");
        expect(status.textContent).toContain("✓");
        expect(status.className).toContain("text-green-600");
    });

    it("shows a red failure indicator for a connection test", () => {
        radio.current.radio_connection_result = {
            ok: false,
            failure: "connection",
            errors: [{ field: "connection", message: "No radio", details: "Hamlib trace" }],
        };
        render_cat();

        const status = screen.getAllByRole("alert").find(element => element.tagName === "P");
        expect(status.textContent).toContain("✕ No radio");
        expect(status.className).toContain("text-red-600");
        expect(screen.queryByRole("list")).toBeNull();
        const details = screen.getByText("Details").parentElement;
        expect(details.open).toBe(false);
        details.querySelector("summary").click();
        expect(details.open).toBe(true);
        expect(details.textContent).toContain("Hamlib trace");
        expect(details.querySelector("code").style.backgroundColor).toBe("white");
    });

    it("shows a successful radio hardware save result", async () => {
        radio.current.radio_configuration_result = { ok: true };
        render_cat();
        expect((await screen.findByRole("status")).textContent).toContain("Radio hardware saved.");
    });

    it("shows all server errors and highlights the selected rig", async () => {
        const user = userEvent.setup();
        radio.current.radio_configuration_result = {
            ok: false,
            failure: "invalid_config",
            errors: [
                { field: "rig1.rigctld.host", message: "Invalid Rig 1 host" },
                { field: "rig2.rigctld.port", message: "Invalid Rig 2 port" },
            ],
        };
        render_cat();
        const errors = screen.getAllByRole("alert")[0];
        expect(errors.textContent).toContain("Invalid Rig 1 host");
        expect(errors.textContent).toContain("Invalid Rig 2 port");
        expect(
            screen.queryByText("Fix the highlighted radio settings before applying."),
        ).toBeNull();
        await user.selectOptions(screen.getByLabelText("Rig"), "rig2");
        expect(screen.getByLabelText("Port").className).toContain("bg-red-200");
        expect(errors.textContent).toContain("Invalid Rig 2 port");
    });

    it("keeps logger integration available for legacy CAT servers", () => {
        radio.current.radio_capabilities = null;
        render_cat();
        expect(screen.queryByRole("heading", { name: "Radio hardware" })).toBeNull();
        expect(screen.getByText("Enable logger integration:")).not.toBeNull();
        expect(radio.current.get_radio_configuration).not.toHaveBeenCalled();
    });
});
