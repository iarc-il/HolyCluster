import { expect, test } from "@playwright/test";

const models = [
    { id: "hamlib:1", manufacturer: "Hamlib", model: "Dummy", connection_kind: "none" },
    { id: "hamlib:2", manufacturer: "Acme", model: "Serial rig", connection_kind: "serial" },
    {
        id: "hamlib:3",
        manufacturer: "Hamlib",
        model: "NET rigctl",
        connection_kind: "network",
    },
    { id: "omnirig:1", manufacturer: "OmniRig", model: "OmniRig Rig 1", connection_kind: "none" },
    { id: "omnirig:2", manufacturer: "OmniRig", model: "OmniRig Rig 2", connection_kind: "none" },
];

const rotator_models = [
    {
        id: "1",
        manufacturer: "Hamlib",
        model: "Dummy",
        port_type: "none",
        enabled: true,
    },
];

const descriptors = {
    "hamlib:1": [],
    "hamlib:2": [
        { kind: "text", token: "rig_pathname", label: "Pathname", tooltip: "", default: "" },
        {
            kind: "integer",
            token: "serial_speed",
            label: "Baud rate",
            tooltip: "",
            default: 9600,
            minimum: 1200,
            maximum: 115200,
            step: 1200,
        },
    ],
    "hamlib:3": [
        { kind: "text", token: "rig_pathname", label: "Pathname", tooltip: "", default: "" },
    ],
    "omnirig:1": [],
    "omnirig:2": [],
};

const radio_status = {
    type: "radio",
    event: "status",
    status: "connected",
    freq: 14_074_000,
    mode: "DIGI",
    catserver_version: "catserver-v1.3.0",
};

const radio_config = {
    rig: { model_id: "hamlib:1", token_values: {} },
};

test("renders unified radio model connection flows in CAT Control", async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.setItem("first_launch", "false");
        localStorage.setItem("active_view", "0");
    });
    await page.routeWebSocket("**/ws", websocket => {
        websocket.onMessage(message => {
            const request = JSON.parse(message);
            if (request.type === "spots") {
                websocket.send(JSON.stringify(radio_status));
                return;
            }
            if (request.type === "rotator") {
                if (request.action === "GetRotatorConfiguration") {
                    websocket.send(
                        JSON.stringify({
                            type: "rotator",
                            event: "rotator_configuration",
                            backend: "unconfigured",
                        }),
                    );
                } else if (request.action === "ListRotatorModels") {
                    websocket.send(
                        JSON.stringify({
                            type: "rotator",
                            event: "rotator_models",
                            models: rotator_models,
                        }),
                    );
                }
                return;
            }
            if (request.type !== "radio") return;
            websocket.send(JSON.stringify(radio_status));
            switch (request.action) {
                case "GetCapabilities":
                    websocket.send(
                        JSON.stringify({
                            type: "radio",
                            event: "capabilities",
                            radio_configuration: true,
                            radio_configuration_api: 2,
                            rotator_configuration: true,
                        }),
                    );
                    break;
                case "GetRadioConfiguration":
                    websocket.send(
                        JSON.stringify({ type: "radio", event: "configuration", ...radio_config }),
                    );
                    break;
                case "ListRadioModels":
                    websocket.send(
                        JSON.stringify({ type: "radio", event: "radio_models", models }),
                    );
                    break;
                case "ListSerialPorts":
                    websocket.send(
                        JSON.stringify({
                            type: "radio",
                            event: "serial_ports",
                            ports: ["/dev/ttyUSB0"],
                        }),
                    );
                    break;
                case "DescribeRadioModel":
                    websocket.send(
                        JSON.stringify({
                            type: "radio",
                            event: "radio_model",
                            model_id: request.model_id,
                            descriptors: descriptors[request.model_id],
                        }),
                    );
                    break;
            }
        });
    });

    await page.goto("/");
    await page.locator("[data-tour='top-bar-settings']").click();
    await page.getByRole("button", { name: "CAT Control" }).click();

    const model = page.getByRole("combobox", { name: "Model", exact: true });
    await model.click();
    await expect(page.getByRole("listbox").getByRole("option").first()).toHaveText("Unconfigured");
    await page.getByRole("option", { name: "Hamlib Dummy" }).click();

    for (const [name, connection] of [
        ["Unconfigured", "none"],
        ["Acme Serial rig", "serial"],
        ["Hamlib NET rigctl", "network"],
        ["OmniRig Rig 1", "none"],
        ["OmniRig Rig 2", "none"],
        ["Hamlib Dummy", "none"],
    ]) {
        await model.click();
        await page.getByRole("option", { name }).click();
        if (connection === "serial") {
            await expect(page.getByLabel("Serial port")).toBeVisible();
        } else if (connection === "network") {
            await expect(page.getByRole("heading", { name: "Network connection" })).toBeVisible();
            await expect(page.getByLabel("Host")).toBeVisible();
            await expect(page.getByLabel("Port")).toBeVisible();
        } else {
            await expect(page.getByLabel("Serial port")).toBeHidden();
            await expect(page.getByLabel("Host")).toBeHidden();
        }
    }

    const rotator_settings = page.getByRole("region", { name: "Rotator hardware settings" });
    const rotator_model = page.getByRole("combobox", { name: "Rotator model" });
    await expect(rotator_settings.getByText("Unconfigured")).toBeVisible();
    await rotator_model.click();
    await expect(page.getByRole("listbox").getByRole("option").first()).toHaveText("Unconfigured");
});
