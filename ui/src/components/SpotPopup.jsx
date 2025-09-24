import { km_to_miles } from "@/utils.js";
import { useColors } from "@/hooks/useColors";
import { useSettings } from "@/hooks/useSettings";

function SpotPopup({
    hovered_spot,
    set_hovered_spot,
    set_pinned_spot,
    pinned_spot_data,
    hovered_spot_data,
    distance,
    azimuth,
}) {
    const { colors } = useColors();
    const { settings } = useSettings();

    const spot_data = hovered_spot_data ?? pinned_spot_data;

    if (!spot_data) {
        return <></>;
    }

    return (
        <div
            className="absolute w-fit z-40 bottom-2 left-2 border-l-4 pl-2"
            onMouseOver={() => set_hovered_spot(hovered_spot)}
            onMouseLeave={() => set_hovered_spot({ source: null, id: null })}
            onClick={() => set_pinned_spot(hovered_spot)}
            style={{
                borderColor: colors.bands[spot_data.band],
                color: colors.theme.text,
            }}
        >
            <div className="text-sm font-bold">
                <p>
                    DX: {spot_data.dx_callsign}
                    {"continent_dx" in spot_data ? ", " + spot_data.continent_dx : ""}
                </p>
                <p>Frequency: {spot_data.freq}</p>
                <p>DX Country: {spot_data.dx_country}</p>
                <p>Spotter: {spot_data.spotter_callsign}</p>
                <p>
                    Distance: {settings.is_miles ? km_to_miles(distance) : distance}{" "}
                    {settings.is_miles ? "Miles" : "KM"}
                </p>
                <p>Azimuth: {Math.round(azimuth)}°</p>
            </div>
        </div>
    );
}

export default SpotPopup;
