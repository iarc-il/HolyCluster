import log4omImage from "@/assets/log4om_integration.png";
import HelpIcon from "@/components/ui/HelpIcon.jsx";
import Input from "@/components/ui/Input.jsx";
import Modal from "@/components/ui/Modal.jsx";
import Select from "@/components/ui/Select.jsx";
import Toggle from "@/components/ui/Toggle.jsx";
import use_radio from "@/hooks/useRadio";
import { useState } from "react";

function CatControl({ temp_settings, set_temp_settings, colors }) {
    const { is_radio_available } = use_radio();

    const is_port_valid =
        temp_settings.highlight_port >= 1024 && temp_settings.highlight_port <= 65535;
    const is_aclog_port_valid =
        temp_settings.aclog_port >= 1024 && temp_settings.aclog_port <= 65535;

    return (
        <>
            <div className="p-4" data-tour="settings-cat-control">
                <table
                    className="table-fixed border-separate border-spacing-y-2"
                    style={{ color: colors.theme.text }}
                >
                    <tbody>
                        <tr>
                            <td>Enable Log4OM integration:&nbsp;&nbsp;</td>
                            <td className="flex gap-2">
                                <Toggle
                                    value={temp_settings.highlight_enabled}
                                    data_tour="settings-cat-logger-toggle"
                                    on_click={() => {
                                        set_temp_settings({
                                            ...temp_settings,
                                            highlight_enabled: !temp_settings.highlight_enabled,
                                        });
                                    }}
                                />
                                <Modal
                                    title={
                                        <h3
                                            className="text-2xl"
                                            style={{ color: colors.theme.text }}
                                        >
                                            Log4OM Integration Guide
                                        </h3>
                                    }
                                    button={<HelpIcon size="20" />}
                                    data_tour="settings-cat-log4om-help"
                                    dialog_data_tour="settings-cat-log4om-modal"
                                >
                                    <p>
                                        When clicking on a callsign, the CAT server can notify
                                        Log4OM and autofill the callsign field.
                                    </p>
                                    <p>To configure this feature, follow this guide:</p>
                                    <div className="p-4 w-max-[80rem] flex justify-center items-center">
                                        <img
                                            src={log4omImage}
                                            alt="Log4OM Integration Guide"
                                            className="max-w-full h-auto"
                                        />
                                    </div>
                                </Modal>
                            </td>
                        </tr>
                        <tr>
                            <td>UDP Port:</td>
                            <td>
                                <Input
                                    value={temp_settings.highlight_port}
                                    className={is_port_valid ? "" : "bg-red-200"}
                                    data-tour="settings-cat-udp-port"
                                    type="number"
                                    min="1024"
                                    max="65535"
                                    onChange={event => {
                                        set_temp_settings({
                                            ...temp_settings,
                                            highlight_port: Number.parseInt(event.target.value),
                                        });
                                    }}
                                />
                            </td>
                        </tr>
                        <tr>
                            <td>Enable AC Log integration:&nbsp;&nbsp;</td>
                            <td className="flex gap-2">
                                <Toggle
                                    value={temp_settings.aclog_enabled}
                                    on_click={() => {
                                        set_temp_settings({
                                            ...temp_settings,
                                            aclog_enabled: !temp_settings.aclog_enabled,
                                        });
                                    }}
                                />
                                <Modal
                                    title={
                                        <h3
                                            className="text-2xl"
                                            style={{ color: colors.theme.text }}
                                        >
                                            AC Log Integration Guide
                                        </h3>
                                    }
                                    button={<HelpIcon size="20" />}
                                >
                                    <p>
                                        When clicking on a callsign, the CAT server can prepare the
                                        callsign, frequency, and mode in N3FJP AC Log.
                                    </p>
                                    <p>
                                        In AC Log, enable Settings &gt; Application Program
                                        Interface &gt; TCP API Enabled and use the same TCP port
                                        below.
                                    </p>
                                </Modal>
                            </td>
                        </tr>
                        <tr>
                            <td>AC Log host:</td>
                            <td>
                                <Select
                                    value={temp_settings.aclog_host}
                                    onChange={event => {
                                        set_temp_settings({
                                            ...temp_settings,
                                            aclog_host: event.target.value,
                                        });
                                    }}
                                >
                                    <option value="127.0.0.1">127.0.0.1</option>
                                    <option value="localhost">localhost</option>
                                    <option value="::1">::1</option>
                                </Select>
                            </td>
                        </tr>
                        <tr>
                            <td>AC Log TCP port:</td>
                            <td>
                                <Input
                                    value={temp_settings.aclog_port}
                                    className={is_aclog_port_valid ? "" : "bg-red-200"}
                                    type="number"
                                    min="1024"
                                    max="65535"
                                    onChange={event => {
                                        set_temp_settings({
                                            ...temp_settings,
                                            aclog_port: Number.parseInt(event.target.value),
                                        });
                                    }}
                                />
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </>
    );
}

export default CatControl;
