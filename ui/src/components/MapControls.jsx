import { useMediaQuery } from "@uidotdev/usehooks";

import Input from "@/components/Input.jsx";
import Button from "@/components/Button.jsx";
import Radio from "@/components/Radio.jsx";
import Night from "@/components/Night.jsx";
import Bar from "@/components/Bar.jsx";
import { useColors } from "@/hooks/useColors";

import Maidenhead from "maidenhead";

function MapControls({
    home_locator,
    map_controls,
    set_map_controls,
    radio_status,
    cat_status,
    default_radius,
    set_radius_in_km,
    settings,
    propagation,
}) {
    const { colors } = useColors();

    function reset_map() {
        const locator = home_locator == "" ? "JJ00AA" : home_locator;
        const [lat, lon] = Maidenhead.toLatLon(locator);
        set_map_controls(state => {
            set_radius_in_km(default_radius);
            state.location = { displayed_locator: locator, location: [lon, lat] };
        });
    }

    console.log(radio_status, cat_status);

    if (radio_status === "connected" && cat_status == false) {
        radio_status = "cat_disabled";
    }

    console.log(radio_status);

    const radio_status_to_color = {
        unknown: "#888888",
        unavailable: "#888888",
        connected: "#00DD00",
        cat_disabled: "#FFDD00",
        disconnected: "#DD0000",
    };

    const is_md_device = useMediaQuery("only screen and (min-width : 768px)");

    return (
        <>
            <div className="absolute top-0 z-40 right-0 flex justify-center pt-2 xs:pt-4 gap-2 xs:gap-4 mr-2">
                <button onClick={reset_map}>
                    <svg height="32" width="32" viewBox="0 0 576 512" fill={colors.buttons.utility}>
                        <path d="M575.8 255.5c0 18-15 32.1-32 32.1l-32 0 .7 160.2c0 2.7-.2 5.4-.5 8.1l0 16.2c0 22.1-17.9 40-40 40l-16 0c-1.1 0-2.2 0-3.3-.1c-1.4 .1-2.8 .1-4.2 .1L416 512l-24 0c-22.1 0-40-17.9-40-40l0-24 0-64c0-17.7-14.3-32-32-32l-64 0c-17.7 0-32 14.3-32 32l0 64 0 24c0 22.1-17.9 40-40 40l-24 0-31.9 0c-1.5 0-3-.1-4.5-.2c-1.2 .1-2.4 .2-3.6 .2l-16 0c-22.1 0-40-17.9-40-40l0-112c0-.9 0-1.9 .1-2.8l0-69.7-32 0c-18 0-32-14-32-32.1c0-9 3-17 10-24L266.4 8c7-7 15-8 22-8s15 2 21 7L564.8 231.5c8 7 12 15 11 24z" />
                    </svg>
                </button>
                <Night
                    is_active={map_controls.night}
                    size="40"
                    on_click={event => set_map_controls(state => (state.night = !state.night))}
                />

                <div className="ml-auto">
                    {
                        // Remove this when we release the radio CAT control feature!!!
                        radio_status != "unavailable" && radio_status != "unknown" ? (
                            <Radio color={radio_status_to_color[radio_status]} size="40"></Radio>
                        ) : (
                            ""
                        )
                    }
                </div>
            </div>
            {propagation && is_md_device && settings.propagation_displayed && (
                <div className="absolute bottom-2 z-40 right-5 flex justify-center pt-1 xs:pt-2 gap-1 xs:gap-2">
                    <Bar
                        value={Math.round(propagation.a_index)}
                        label="A"
                        min={0}
                        max={20}
                        low_mid={6}
                        mid_high={10}
                    />
                    <Bar
                        value={Math.round(propagation.k_index)}
                        label="K"
                        min={0}
                        max={9}
                        low_mid={3}
                        mid_high={5}
                    />
                    <Bar
                        value={Math.round(propagation.sfi)}
                        label="SFI"
                        min={0}
                        max={200}
                        reverse_colors={true}
                        low_mid={70}
                        mid_high={100}
                    />
                </div>
            )}
        </>
    );
}

export default MapControls;
