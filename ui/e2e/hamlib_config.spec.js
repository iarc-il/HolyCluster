import { expect, test } from "@playwright/test";

const models = [
    { id: "1", manufacturer: "Hamlib", model: "Dummy", port_type: "none" },
    { id: "2", manufacturer: "Acme", model: "Serial rig", port_type: "serial" },
    { id: "3", manufacturer: "Hamlib", model: "NET rigctl", port_type: "network" },
    { id: "4", manufacturer: "Hamlib", model: "UDP rigctl", port_type: "udp_network" },
    { id: "5", manufacturer: "Acme", model: "USB rig", port_type: "usb" },
];

const descriptors = {
    1: [{ kind: "text", token: "rig_pathname", label: "Pathname", tooltip: "", default: "" }],
    2: [
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
    3: [{ kind: "text", token: "rig_pathname", label: "Pathname", tooltip: "", default: "" }],
    4: [{ kind: "text", token: "rig_pathname", label: "Pathname", tooltip: "", default: "" }],
    5: [{ kind: "text", token: "rig_pathname", label: "Pathname", tooltip: "", default: "" }],
};

const radio_status = {
    type: "radio",
    event: "status",
    status: "connected",
    freq: 14_074_000,
    mode: "DIGI",
    current_rig: 1,
    catserver_version: "catserver-v1.3.0",
};

const radio_config = {
    rig1: {
        backend: "hamlib",
        hamlib: { model_id: "1", token_values: {} },
    },
};

test("renders every supported Hamlib port flow in CAT Control", async ({ page }) => {
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
            if (request.type !== "radio") return;
            websocket.send(JSON.stringify(radio_status));
            switch (request.action) {
                case "GetCapabilities":
                    websocket.send(
                        JSON.stringify({
                            type: "radio",
                            event: "capabilities",
                            radio_configuration: true,
                            backends: ["hamlib"],
                        }),
                    );
                    break;
                case "GetRadioConfiguration":
                    websocket.send(
                        JSON.stringify({ type: "radio", event: "configuration", ...radio_config }),
                    );
                    break;
                case "ListHamlibModels":
                    websocket.send(
                        JSON.stringify({ type: "radio", event: "hamlib_models", models }),
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
                case "DescribeHamlibModel":
                    websocket.send(
                        JSON.stringify({
                            type: "radio",
                            event: "hamlib_model",
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

    const model = page.getByRole("combobox", { name: "Model" });
    for (const [name, connection] of [
        ["Acme Serial rig", "serial"],
        ["Hamlib NET rigctl", "network"],
        ["Hamlib UDP rigctl", "network"],
        ["Acme USB rig", "none"],
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
});
