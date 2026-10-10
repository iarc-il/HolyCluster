import { get_dxcc_label } from "@/data/dxcc_entities.js";
import { useColors } from "@/hooks/useColors";
import { useSettings } from "@/hooks/useSettings";
import { km_to_miles } from "@/utils.js";

function SpotPopup({
    hovered_spot,
    set_hovered_spot,
    set_pinned_spot,
    pinned_spot_data,
    hovered_spot_data,
    distance,
    antenna_azimuth,
    antenna_azimuth_source,
    map_azimuth,
}) {
    const { colors, dev_mode } = useColors();
    const { settings } = useSettings();

    const spot_data = hovered_spot_data ?? pinned_spot_data;

    if (!spot_data) {
        return <></>;
    }

    const antenna_azimuth_label = Number.isFinite(antenna_azimuth)
        ? `${Math.round(antenna_azimuth)}°`
        : "--";
    const map_azimuth_label = Number.isFinite(map_azimuth) ? `${Math.round(map_azimuth)}°` : "--";
    const show_map_azimuth =
        Number.isFinite(antenna_azimuth) &&
        Number.isFinite(map_azimuth) &&
        Math.round(antenna_azimuth) !== Math.round(map_azimuth);

    return (
        <div
            className="absolute w-fit z-40 bottom-2 left-2 border-l-4 pl-2"
            data-tour="spot-popup"
            onMouseOver={() => set_hovered_spot(hovered_spot)}
            onMouseLeave={() => set_hovered_spot({ source: null, id: null })}
            onFocus={() => set_hovered_spot(hovered_spot)}
            onBlur={() => set_hovered_spot({ source: null, id: null })}
            onClick={() => set_pinned_spot(hovered_spot)}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    set_pinned_spot(hovered_spot);
                }
            }}
            role="button"
            tabIndex={0}
            style={{
                borderColor: colors.bands[spot_data.band],
                color: colors.theme.text,
            }}
        >
            <div className="text-sm font-bold">
                <p>
                    DX: {spot_data.dx_callsign}
                    {"continent_dx" in spot_data ? `, ${spot_data.continent_dx}` : ""}
                </p>
                <p>Frequency: {spot_data.freq}</p>
                <p>DXCC: {get_dxcc_label(spot_data.dx_dxcc_code) || spot_data.dx_country}</p>
                <p>Spotter: {spot_data.spotter_callsign}</p>
                <p>
                    Distance: {settings.is_miles ? km_to_miles(distance) : distance}{" "}
                    {settings.is_miles ? "Miles" : "km"}
                </p>
                {dev_mode ? (
                    <>
                        <p>
                            Antenna: {antenna_azimuth_label}
                            {antenna_azimuth_source === "map" ? " (map center)" : ""}
                        </p>
                        {show_map_azimuth && <p>Map: {map_azimuth_label}</p>}
                    </>
                ) : (
                    <p>Azimuth: {map_azimuth_label}</p>
                )}
                {spot_data.missingNeeded?.is_needed && (
                    <p className="mt-1">
                        {spot_data.missingNeeded.reasons
                            .slice(0, 3)
                            .map(r => r.label)
                            .join(", ")}
                        {spot_data.missingNeeded.reasons.length > 3 && "..."}
                    </p>
                )}
            </div>
        </div>
    );
}

export default SpotPopup;
