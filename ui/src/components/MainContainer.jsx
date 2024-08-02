import Map from "./Map.jsx";
import MapControls from "./MapControls.jsx";
import Filters from "./Filters.jsx";
import BandSpots from "./BandSpots.jsx";

import { useState } from "react";

// This is temporary mock data
import spots from "../assets/spots.json";

const band_colors = {
    160: "#f65356",
    80: "#fb8066",
    40: "#fea671",
    30: "#fec979",
    20: "#feea80",
    17: "#d7e586",
    15: "#a5de94",
    12: "#5daad8",
    10: "#8187c7",
    6: "#c56bba",
};

const modes = ["SSB", "CW", "FT8", "RTTY", "PSK", "AM", "FM"];

function MainContainer() {
    const [projection_type, set_projection_type] = useState("AzimuthalEquidistant");
    const [night_enabled, set_night] = useState(false);

    const [location, set_location] = useState({
        displayed_locator: "",
        // Longitude, latitude
        location: [0, 0]
    });

    const [enabled_bands, set_enabled_bands] = useState(
        Object.fromEntries(Object.keys(band_colors).map(band => [band, true]))
    )
    const [enabled_modes, set_enabled_modes] = useState(
        Object.fromEntries(modes.map(mode => [mode, true]))
    )
    const [spots_time_limit, set_spots_time_limit] = useState(60)

    const current_time = new Date().getTime() / 1000;
    const filtered_spots = spots
        .filter(spot => (current_time - spot.time) / 60 < spots_time_limit)
        .filter(spot => enabled_bands[spot.Band] && enabled_modes[spot.Mode])
        .slice(0, 100)

    return (
        <div className="max-xl:mx-4 xl:mx-20 shadow-xl rounded-2xl border-solid border-slate-200 border-2 min-w-[740px]">
            <Filters
                band_colors={band_colors}
                enabled_bands={enabled_bands}
                set_enabled_bands={set_enabled_bands}
                enabled_modes={enabled_modes}
                set_enabled_modes={set_enabled_modes}
                spots_time_limit={spots_time_limit}
                set_spots_time_limit={set_spots_time_limit}
            />
            <div className="flex max-lg:flex-wrap divide-x divide-slate-300">
                <div className="w-full divide-y divide-slate-300">
                    <MapControls
                        set_projection_type={set_projection_type}
                        set_night={set_night}
                        location={location}
                        set_location={set_location}
                    />
                    <Map
                        spots={filtered_spots}
                        band_colors={band_colors}
                        projection_type={projection_type}
                        night_enabled={night_enabled}
                        enabled_bands={enabled_bands}
                        location={location}
                        set_location={set_location}
                    />
                </div>
                <div className="flex flex-wrap content-start items-stretch  w-full text-center gap-2 p-4 overflow-x-auto">
                    {Object.entries(band_colors).map(([band, color]) => {
                        if (enabled_bands[band]) {
                            return <BandSpots
                                key={band}
                                band={band}
                                color={color}
                                spots={filtered_spots}
                                enabled_modes={enabled_modes}
                            />;
                        } else {
                            return <></>
                        }
                    })}
                </div>
            </div>
        </div>
    );
}

export default MainContainer;
