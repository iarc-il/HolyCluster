import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const radio = vi.hoisted(() => ({ current: null }));

vi.mock("@/hooks/useRadio", () => ({ default: () => radio.current }));
vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({
        colors: {
            theme: { input_background: "white", text: "black", disabled_text: "gray" },
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
    { kind: "text", token: "unsupported", label: "Unsupported", tooltip: "", default: "" },
];

function configuration(
    rig1 = { backend: "rigctld", rigctld: { host: "127.0.0.1", port: 4532 } },
    rig2 = undefined,
) {
    return { event: "configuration", rig1, ...(rig2 ? { rig2 } : {}) };
}

function render_cat() {
    return render(
        <CatControl
            temp_settings={{ highlight_enabled: true, highlight_port: 2237 }}
            set_temp_settings={vi.fn()}
            colors={colors}
        />,
    );
}

describe("CAT control settings", () => {
    beforeEach(() => {
        radio.current = {
            radio_capabilities: { radio_configuration: true, backends: ["rigctld", "hamlib"] },
            radio_configuration: configuration(),
            radio_configuration_result: null,
            hamlib_models: [{ id: "2", manufacturer: "Acme", model: "Rig" }],
            hamlib_models_error: null,
            hamlib_model_details: { 2: descriptors },
            hamlib_model_error: null,
            get_radio_configuration: vi.fn(),
            list_hamlib_models: vi.fn(),
            describe_hamlib_model: vi.fn(),
            set_radio_configuration: vi.fn(),
        };
    });
    afterEach(() => cleanup());

    it("always provides a native Rig 1 and Rig 2 selector", () => {
        render_cat();
        expect(screen.getByLabelText("Rig").tagName).toBe("SELECT");
        expect(screen.getByRole("option", { name: "Rig 1" })).not.toBeNull();
        expect(screen.getByRole("option", { name: "Rig 2" })).not.toBeNull();
    });

    it("preserves independent rig drafts while switching rigs and backends", async () => {
        const user = userEvent.setup();
        render_cat();
        await user.clear(screen.getByLabelText("Host"));
        await user.type(screen.getByLabelText("Host"), "rig-one");
        await user.selectOptions(screen.getByLabelText("Rig"), "rig2");
        await user.click(screen.getByLabelText("Enable Rig 2"));
        await user.selectOptions(screen.getByLabelText("Backend"), "hamlib");
        await user.selectOptions(screen.getByLabelText("Model"), "2");
        expect(screen.getByLabelText("Serial port")).not.toBeNull();
        expect(screen.queryByLabelText("Unsupported")).toBeNull();
        await user.selectOptions(screen.getByLabelText("Rig"), "rig1");
        expect(screen.getByLabelText("Host").value).toBe("rig-one");
        await user.selectOptions(screen.getByLabelText("Rig"), "rig2");
        expect(screen.getByLabelText("Model").value).toBe("2");
    });

    it("serializes only active backend payloads", async () => {
        const user = userEvent.setup();
        render_cat();
        await user.click(screen.getByRole("button", { name: "Save radio hardware" }));
        expect(radio.current.set_radio_configuration).toHaveBeenCalledWith({
            rig1: { backend: "rigctld", rigctld: { host: "127.0.0.1", port: 4532 } },
        });
    });

    it("shows a successful radio hardware save result", async () => {
        radio.current.radio_configuration_result = { ok: true };
        render_cat();
        expect((await screen.findByRole("status")).textContent).toContain("Radio hardware saved.");
    });

    it("validates rigctld ports on blur and scopes server errors to the selected rig", async () => {
        const user = userEvent.setup();
        radio.current.radio_configuration_result = {
            ok: false,
            error: { field: "rig2.rigctld.port", message: "Invalid Rig 2 port" },
        };
        render_cat();
        expect(screen.queryByText("Invalid Rig 2 port")).toBeNull();
        await user.clear(screen.getByLabelText("Port"));
        await user.tab();
        expect(screen.getByLabelText("Port").getAttribute("aria-invalid")).toBeNull();
        expect(screen.getByLabelText("Port").className).toContain("bg-red-200");
        await user.selectOptions(screen.getByLabelText("Rig"), "rig2");
        expect(screen.getByRole("alert").textContent).toContain("Invalid Rig 2 port");
    });

    it("keeps logger integration available for legacy CAT servers", () => {
        radio.current.radio_capabilities = null;
        render_cat();
        expect(screen.queryByRole("heading", { name: "Radio hardware" })).toBeNull();
        expect(screen.getByText("Enable logger integration:")).not.toBeNull();
        expect(radio.current.get_radio_configuration).not.toHaveBeenCalled();
    });
});
