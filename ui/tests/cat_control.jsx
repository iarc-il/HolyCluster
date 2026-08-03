import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const radio = vi.hoisted(() => ({ current: null }));

vi.mock("@/hooks/useRadio", () => ({ default: () => radio.current }));
vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({ theme: { input_background: "white", text: "black", disabled_text: "gray" } }),
}));

import CatControl from "@/components/settings/CatControl.jsx";

const colors = { theme: { text: "black" } };
const descriptors = [
    { kind: "text", token: "device", label: "Device", tooltip: "", default: "" },
    { kind: "path", token: "path", label: "Path", tooltip: "", default: "" },
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
    { kind: "boolean", token: "rts", label: "RTS", tooltip: "", default: false },
    { kind: "combo", token: "parity", label: "Parity", tooltip: "", default: "none", options: ["none", "even"] },
];

function configuration(hamlib = null) {
    return { event: "configuration", backend: hamlib == null ? "omnirig" : "hamlib", hamlib };
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
            radio_capabilities: { radio_configuration: true, backends: ["omnirig", "hamlib"] },
            radio_configuration: configuration(),
            radio_configuration_result: null,
            radio_retry_result: null,
            radio_status: "connected",
            hamlib_models: [{ id: "2", manufacturer: "Acme", model: "Rig", version: "", status: "stable" }],
            hamlib_models_error: null,
            hamlib_model_detail: descriptors,
            hamlib_model_details: { "2": descriptors },
            hamlib_model_error: null,
            get_radio_configuration: vi.fn(),
            list_hamlib_models: vi.fn(),
            describe_hamlib_model: vi.fn(),
            set_radio_configuration: vi.fn(),
            retry_radio: vi.fn(),
        };
    });

    afterEach(() => cleanup());

    it("shows capable disconnected controls and retries the radio", async () => {
        const user = userEvent.setup();
        radio.current.radio_status = "disconnected";
        render_cat();

        expect(screen.getByRole("heading", { name: "Radio hardware" })).not.toBeNull();
        expect(screen.getByText("Radio disconnected")).not.toBeNull();
        await user.click(screen.getByRole("button", { name: "Retry" }));

        expect(radio.current.retry_radio).toHaveBeenCalledOnce();
    });

    it("requires Rig 1 before applying Hamlib settings", async () => {
        const user = userEvent.setup();
        render_cat();

        await user.selectOptions(screen.getByLabelText("Backend"), "hamlib");

        expect(screen.getByRole("button", { name: "Apply radio hardware" })).toBeDisabled();
    });

    it("renders descriptor inputs and supports an optional second rig", async () => {
        const user = userEvent.setup();
        radio.current.radio_configuration = configuration({
            rig1: { model_id: "2", token_values: {} },
            rig2: null,
        });
        render_cat();

        expect(screen.getByLabelText("Device")).not.toBeNull();
        expect(screen.getByLabelText("Path")).not.toBeNull();
        expect(screen.getByLabelText("Baud")).not.toBeNull();
        expect(screen.getByLabelText("RTS")).not.toBeNull();
        expect(screen.getByLabelText("Parity")).not.toBeNull();
        await user.click(screen.getByRole("button", { name: "Add Rig 2" }));

        expect(screen.getByText("Rig 2")).not.toBeNull();
        expect(screen.getByRole("button", { name: "Remove Rig 2" })).not.toBeNull();
    });

    it("surfaces server field and token errors", () => {
        radio.current.radio_configuration = configuration({
            rig1: { model_id: "2", token_values: {} },
            rig2: null,
        });
        radio.current.radio_configuration_result = {
            ok: false,
            error: { field: "hamlib.rig1.token_values", token: "device", message: "Invalid device" },
        };
        render_cat();

        expect(screen.getByRole("alert")).toHaveTextContent("Invalid device");
        expect(screen.getByLabelText("Device")).toHaveAttribute("aria-invalid", "true");
    });

    it("keeps logger integration available for legacy CAT servers", () => {
        radio.current.radio_capabilities = null;
        render_cat();

        expect(screen.queryByRole("heading", { name: "Radio hardware" })).toBeNull();
        expect(screen.getByText("Enable logger integration:")).not.toBeNull();
        expect(radio.current.get_radio_configuration).not.toHaveBeenCalled();
    });
});
