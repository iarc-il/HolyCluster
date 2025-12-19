import { useState } from "react";
import Input from "@/components/Input.jsx";
import Toggle from "@/components/Toggle.jsx";
import Modal from "@/components/Modal.jsx";
import HelpIcon from "@/components/HelpIcon.jsx";
import use_radio from "@/hooks/useRadio";
import log4omImage from "@/assets/log4om_integration.png";

function CatControl({ temp_settings, set_temp_settings, colors }) {
    const { is_radio_available } = use_radio();

    const is_port_valid =
        temp_settings.highlight_port >= 1024 && temp_settings.highlight_port <= 65535;

    return (
        <>
            <div className="p-4">
                <table
                    className="table-fixed border-separate border-spacing-y-2"
                    style={{ color: colors.theme.text }}
                >
                    <tbody>
                        <tr>
                            <td>Report callsign at click:&nbsp;&nbsp;</td>
                            <td className="flex gap-2">
                                <Toggle
                                    value={temp_settings.highlight_enabled}
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
                                    type="number"
                                    min="1024"
                                    max="65535"
                                    onChange={event => {
                                        set_temp_settings({
                                            ...temp_settings,
                                            highlight_port: parseInt(event.target.value),
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
