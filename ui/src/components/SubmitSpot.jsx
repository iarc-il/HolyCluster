import { useEffect, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { ToastContainer, toast } from "react-toastify";

import Input from "@/components/Input.jsx";
import Button from "@/components/Button.jsx";
import Modal from "@/components/Modal.jsx";
import Spinner from "@/components/Spinner.jsx";
import { useColors } from "@/hooks/useColors";
import use_radio from "../hooks/useRadio";
import { is_same_base_callsign } from "@/utils.js";

function SubmitIcon({ size }) {
    const { colors } = useColors();
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
            <path
                d="M9 12H15M12 9V15M3 12C3 13.1819 3.23279 14.3522 3.68508 15.4442C4.13738 16.5361 4.80031 17.5282 5.63604 18.364C6.47177 19.1997 7.46392 19.8626 8.55585 20.3149C9.64778 20.7672 10.8181 21 12 21C13.1819 21 14.3522 20.7672 15.4442 20.3149C16.5361 19.8626 17.5282 19.1997 18.364 18.364C19.1997 17.5282 19.8626 16.5361 20.3149 15.4442C20.7672 14.3522 21 13.1819 21 12C21 9.61305 20.0518 7.32387 18.364 5.63604C16.6761 3.94821 14.3869 3 12 3C9.61305 3 7.32387 3.94821 5.63604 5.63604C3.94821 7.32387 3 9.61305 3 12Z"
                stroke={colors.buttons.utility}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

const empty_temp_data = {
    callsign: "",
    freq: 0,
    comment: "",
};

function connect_to_submit_spot_endpoint(on_response) {
    const host = window.location.host;
    const protocol = window.location.protocol;
    const websocket_url = (protocol == "https:" ? "wss:" : "ws:") + "//" + host + "/submit_spot";

    const { sendJsonMessage, readyState, lastJsonMessage } = useWebSocket(websocket_url, {
        shouldReconnect: () => true,
        reconnectAttempts: 1000,
        reconnectInterval: 3000,
    });

    useEffect(() => {
        if (lastJsonMessage != null) {
            if ("status" in lastJsonMessage) {
                on_response(lastJsonMessage);
            }
        }
    }, [lastJsonMessage]);

    return { sendJsonMessage, readyState };
}

function SubmitSpot({ settings, dev_mode }) {
    const [temp_data, set_temp_data] = useState(empty_temp_data);
    const [submit_status, set_submit_status] = useState({
        status: "pending",
        reason: "",
    });
    const { colors, setTheme } = useColors();

    const [external_close, set_external_close] = useState(true);
    const [is_open, set_is_open] = useState(false);
    const [is_testing, set_is_testing] = useState(false);
    let { radio_freq } = use_radio();
    radio_freq = radio_freq ?? 0;

    useEffect(() => {
        if (is_open) {
            return;
        }

        const initial_data = temp_data;
        initial_data.freq = Math.round((radio_freq / 1000 || 0) * 10) / 10;
        set_temp_data(initial_data);
    }, [radio_freq, is_open]);

    function on_response(response) {
        if (response.status == "success") {
            set_submit_status({ status: "success", reason: "" });
            set_is_open(false);
            set_external_close(false);
            let theme;
            if (settings.theme == "Light") {
                theme = "light";
            } else {
                theme = "dark";
            }
            toast.success("Spot submitted successfully!", { theme });
        } else if (response.status == "failure") {
            set_submit_status({ status: "failure", reason: response.type });
        }
    }
    let { sendJsonMessage, readyState } = connect_to_submit_spot_endpoint(on_response);

    useEffect(() => {
        if (readyState == ReadyState.OPEN) {
            set_submit_status({
                status: "pending",
                reason: "",
            });
        }
    }, [readyState]);

    function reset_temp_data() {
        set_temp_data(empty_temp_data);
    }

    function try_to_submit_spot() {
        if (readyState == ReadyState.OPEN) {
            set_submit_status({ status: "sending", reason: "" });
            const message = {
                spotter_callsign: settings.callsign,
                dx_callsign: temp_data.callsign,
                freq: temp_data.freq,
                comment: temp_data.comment,
            };
            if (is_testing) {
                message.testing = true;
            }
            sendJsonMessage(message);
        }
    }

    const not_connected = readyState != ReadyState.OPEN;

    let formatted_failure, formatted_state;
    if (not_connected) {
        formatted_state = "Connection error";
        formatted_failure = "Couldn't reach the server";
    } else if (submit_status.status == "failure") {
        formatted_state = "Failed to submit spot";
        if (submit_status.reason == "InvalidSpotter") {
            formatted_failure = "The spotter callsign is invalid";
        } else if (submit_status.reason == "LoginFailed") {
            formatted_failure = "Login to cluster failed";
        } else if (submit_status.reason == "SpotNotSubmitted") {
            formatted_failure = "Unknown";
        } else if (submit_status.reason == "OtherError") {
            formatted_failure = "Other unspecified error";
        } else if (submit_status.reason == "InvalidFrequency") {
            formatted_failure = "Invalid frequency";
        } else if (submit_status.reason == "InvalidDXCallsign") {
            formatted_failure = "Invalid DX callsign";
        } else if (submit_status.reason == "ClusterConnectionFailed") {
            formatted_failure = "Couldn't react the remote cluster server";
        }
    }

    function find_base_callsign(callsign) {
        return callsign.split("/").reduce((a, b) => (a.length > b.length ? a : b));
    }
    let is_self_spotting = is_same_base_callsign(settings.callsign, temp_data.callsign);

    return (
        <>
            <Modal
                title={
                    <h3 className="text-3xl" style={{ color: colors.theme.text }}>
                        Submit a new spot
                    </h3>
                }
                button={<SubmitIcon size="32"></SubmitIcon>}
                on_open={() => {
                    set_is_open(true);
                    set_external_close(true);
                    reset_temp_data();
                }}
                on_cancel={() => {
                    set_is_open(false);
                }}
                external_close={external_close}
            >
                <table
                    className="mt-3 mx-2 w-full border-separate border-spacing-y-2"
                    style={{ color: colors.theme.text }}
                >
                    <tbody>
                        <tr>
                            <td>Spotter callsign:</td>
                            <td>
                                <Input value={settings.callsign} className="uppercase" disabled />
                            </td>
                        </tr>
                        <tr>
                            <td>DX callsign:</td>
                            <td>
                                <Input
                                    value={temp_data.callsign}
                                    maxLength={11}
                                    className="uppercase"
                                    onChange={event => {
                                        set_temp_data({
                                            ...temp_data,
                                            callsign: event.target.value.toUpperCase(),
                                        });
                                    }}
                                />
                            </td>
                        </tr>
                        <tr>
                            <td>Frequency:</td>
                            <td>
                                <Input
                                    value={temp_data.freq}
                                    onChange={event => {
                                        const value = event.target.value;
                                        if (/^\d*\.?\d{0,1}$/.test(value)) {
                                            if (Number.parseFloat(value) <= 75000 || value == "") {
                                                set_temp_data({
                                                    ...temp_data,
                                                    freq: value,
                                                });
                                            }
                                        }
                                    }}
                                />
                                &nbsp;KHz
                            </td>
                        </tr>
                        <tr>
                            <td>Comment:</td>
                        </tr>
                        <tr>
                            <td colSpan="2">
                                <Input
                                    value={temp_data.comment}
                                    className="w-18"
                                    onChange={event => {
                                        set_temp_data({
                                            ...temp_data,
                                            comment: event.target.value,
                                        });
                                    }}
                                />
                            </td>
                        </tr>
                        {dev_mode ? (
                            <tr>
                                <td colSpan="2">
                                    Testing only: &nbsp;
                                    <input
                                        type="checkbox"
                                        checked={is_testing}
                                        onChange={_ => set_is_testing(!is_testing)}
                                    />
                                </td>
                            </tr>
                        ) : (
                            ""
                        )}
                    </tbody>
                </table>
                {is_self_spotting ? (
                    <p
                        className="pb-2 px-2 text-center text-lg"
                        style={{ color: colors.theme.text }}
                    >
                        Usually, self spotting is discourged
                        <br />
                        in the ham radio community
                    </p>
                ) : (
                    ""
                )}
                {submit_status.status == "failure" || not_connected ? (
                    <p className="pb-2 px-2 text-red-400">
                        {formatted_state}: {formatted_failure}
                    </p>
                ) : (
                    ""
                )}
                <div className="flex justify-center pb-5">
                    <Button on_click={try_to_submit_spot} disabled={readyState !== ReadyState.OPEN}>
                        {submit_status.status == "sending" ? (
                            <Spinner size="20" color="lightblue" />
                        ) : (
                            "Submit"
                        )}
                    </Button>
                </div>
            </Modal>
            <ToastContainer />
        </>
    );
}

export default SubmitSpot;
