import { useMediaQuery } from "@uidotdev/usehooks";

import Input from "@/components/Input.jsx";
import Button from "@/components/Button.jsx";
import Radio from "@/components/Radio.jsx";
import Night from "@/components/Night.jsx";
import PropagationBar from "@/components/PropagationBar.jsx";
import { useColors } from "@/hooks/useColors";
import { useServerData } from "@/hooks/useServerData";
import use_radio from "@/hooks/useRadio";
import { useSettings } from "@/hooks/useSettings";

import Maidenhead from "maidenhead";

function MapControls({
    map_controls,
    set_map_controls,
    set_radius_in_km,
    auto_toggle_radius,
    can_undo_cat,
    undo_cat,
}) {
    const { colors } = useColors();
    const { propagation } = useServerData();
    const { radio_status } = use_radio();
    const { settings } = useSettings();

    function reset_map() {
        const locator = settings.locator == "" ? "JJ00AA" : settings.locator;
        const [lat, lon] = Maidenhead.toLatLon(locator);
        set_map_controls(state => {
            if (!auto_toggle_radius) {
                set_radius_in_km(settings.default_radius);
            }
            state.location = { displayed_locator: locator, location: [lon, lat] };
        });
    }

    const radio_status_to_color = {
        // Probably rig is not configured
        unknown: "#888888",
        // CAT control is working
        connected: "#00DD00",
        // Radio or omnirig is disconnected
        disconnected: "#DD0000",
    };

    const is_md_device = useMediaQuery("only screen and (min-width : 768px)");
    return (
        <>
            <div className="absolute top-0 z-40 right-0 flex justify-end mr-2 pt-2 xs:pt-4 gap-2 xs:gap-4 mb-2">
                {radio_status != "unavailable" && can_undo_cat ? (
                    <Button
                        color="utility"
                        className="p-1"
                        on_click={() => {
                            if (!can_undo_cat) return;
                            undo_cat();
                        }}
                    >
                        <svg fill="currentColor" width="24" height="24" viewBox="0 0 512 512">
                            <path d="M255.545 8c-66.269.119-126.438 26.233-170.86 68.685L48.971 40.971C33.851 25.851 8 36.559 8 57.941V192c0 13.255 10.745 24 24 24h134.059c21.382 0 32.09-25.851 16.971-40.971l-41.75-41.75c30.864-28.899 70.801-44.907 113.23-45.273 92.398-.798 170.283 73.977 169.484 169.442C423.236 348.009 349.816 424 256 424c-41.127 0-79.997-14.678-110.63-41.556-4.743-4.161-11.906-3.908-16.368.553L89.34 422.659c-4.872 4.872-4.631 12.815.482 17.433C133.798 479.813 192.074 504 256 504c136.966 0 247.999-111.033 248-247.998C504.001 119.193 392.354 7.755 255.545 8z" />
                        </svg>
                    </Button>
                ) : (
                    ""
                )}
                <div className="ml-auto flex items-center gap-2">
                    {
                        // Remove this when we release the radio CAT control feature!!!
                        radio_status != "unavailable" ? (
                            <Radio color={radio_status_to_color[radio_status]} size="40"></Radio>
                        ) : null
                    }
                </div>
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
            </div>
            {propagation && is_md_device && settings.propagation_displayed && (
                <div className="absolute bottom-2 z-40 right-5 flex justify-center pt-1 xs:pt-2 gap-1 xs:gap-2">
                    <PropagationBar
                        value={propagation.a_index.value}
                        timestamp={propagation.a_index.timestamp}
                        label="A"
                        min={0}
                        max={100}
                        low_mid={14}
                        mid_high={80}
                    />
                    <PropagationBar
                        value={propagation.k_index.value}
                        timestamp={propagation.k_index.timestamp}
                        label="K"
                        min={0}
                        max={9}
                        low_mid={3}
                        mid_high={5}
                    />
                    <PropagationBar
                        value={propagation.sfi.value}
                        timestamp={propagation.sfi.timestamp}
                        label="SFI"
                        min={0}
                        max={200}
                        low_mid={83}
                        mid_high={120}
                        reverse_colors={true}
                    />
                </div>
            )}
        </>
    );
}

export default MapControls;
