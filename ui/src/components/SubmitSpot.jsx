import { useEffect, useState } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";

import Input from "@/components/Input.jsx";
import Button from "@/components/Button.jsx";
import Modal from "@/components/Modal.jsx";
import { useColors } from "@/hooks/useColors";

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
};

function connect_to_submit_spot_endpoint(on_successful_submit) {
    const host = window.location.host;
    const protocol = window.location.protocol;
    const websocket_url = (protocol == "https:" ? "wss:" : "ws:") + "//" + host + "/submit_spot";

    const { sendJsonMessage, readyState, lastJsonMessage } = useWebSocket(websocket_url);

    useEffect(() => {
        if (lastJsonMessage != null) {
            if ("status" in lastJsonMessage) {
                if (lastJsonMessage.status == "success") {
                    on_successful_submit(lastJsonMessage);
                } else {
                    console.log("Failed to submit spot:", lastJsonMessage);
                }
            }
        }
    }, [lastJsonMessage]);

    function submit_spot(spotter_callsign, dx_callsign, freq) {
        if (readyState == ReadyState.OPEN) {
            sendJsonMessage({ spotter_callsign, dx_callsign, freq });
        }
    }
    return { submit_spot };
}

function SubmitSpot({ current_callsign }) {
    const [temp_data, set_temp_data] = useState(empty_temp_data);
    const [submit_status, set_submit_status] = useState(null);
    const { colors, setTheme } = useColors();

    function on_successful_submit(response) {
        console.log("Success!", response);
    }
    let { submit_spot } = connect_to_submit_spot_endpoint(on_successful_submit);

    function reset_temp_data() {
        set_temp_data(empty_temp_data);
    }

    return (
        <Modal
            title={
                <h3 className="text-3xl" style={{ color: colors.theme.text }}>
                    Submit new spot
                </h3>
            }
            button={<SubmitIcon size="32"></SubmitIcon>}
            on_open={() => reset_temp_data()}
        >
            <table
                className="my-3 mx-2 w-full border-separate border-spacing-y-2"
                style={{ color: colors.theme.text }}
            >
                <tbody>
                    <tr>
                        <td>Spotter callsign:</td>
                        <td>
                            <Input
                                value={current_callsign}
                                maxLength={11}
                                className="uppercase"
                                disabled
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
                                type="number"
                                onChange={event => {
                                    set_temp_data({
                                        ...temp_data,
                                        freq: event.target.value,
                                    });
                                }}
                            />
                        </td>
                    </tr>
                </tbody>
            </table>
            <div className="flex justify-center pb-5">
                <Button
                    on_click={() =>
                        submit_spot(current_callsign, temp_data.callsign, temp_data.freq)
                    }
                >
                    Submit
                </Button>
            </div>
        </Modal>
    );
}

export default SubmitSpot;
