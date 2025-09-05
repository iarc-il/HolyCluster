import { useLocalStorage } from "@uidotdev/usehooks";
import { useEffect } from "react";
import Maidenhead from "maidenhead";

export function to_radian(deg) {
    return deg * (Math.PI / 180);
}

export function to_degrees(rad) {
    return rad * (180 / Math.PI);
}

export function calculate_geographic_azimuth(from_lat, from_lon, to_lat, to_lon) {
    const lat1 = to_radian(from_lat);
    const lon1 = to_radian(from_lon);
    const lat2 = to_radian(to_lat);
    const lon2 = to_radian(to_lon);

    const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
    const x =
        Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
    let azimuth = Math.atan2(y, x);

    return mod(to_degrees(azimuth), 360);
}

export const mod = (n, m) => ((n % m) + m) % m;

function find_base_callsign(callsign) {
    return callsign.split("/").reduce((a, b) => (a.length > b.length ? a : b));
}

export function is_same_base_callsign(callsign1, callsign2) {
    return find_base_callsign(callsign1) == find_base_callsign(callsign2) && callsign1.length > 0;
}

export function is_matching_list(list, spot) {
    return list.some(filter => {
        let matched_value;
        if (filter.type == "comment") {
            matched_value = spot.comment.replace(/&lt;/g, "<").replace(/&gt;/g, ">").toLowerCase();
        } else if (filter.spotter_or_dx == "spotter") {
            if (filter.type == "entity") {
                matched_value = spot.spotter_country;
            } else {
                matched_value = spot.spotter_callsign;
            }
        } else if (filter.spotter_or_dx == "dx") {
            if (filter.type == "entity") {
                matched_value = spot.dx_country;
            } else {
                matched_value = spot.dx_callsign;
            }
        }

        let is_value_matching;
        if (filter.type == "comment") {
            is_value_matching = matched_value.includes(filter.value.toLowerCase());
        } else if (filter.type == "prefix") {
            is_value_matching = matched_value.startsWith(filter.value);
        } else if (filter.type == "suffix") {
            is_value_matching = matched_value.endsWith(filter.value);
        } else if (filter.type == "entity") {
            is_value_matching = matched_value == filter.value;
        } else if (filter.type == "self_spotters") {
            is_value_matching = is_same_base_callsign(spot.dx_callsign, spot.spotter_callsign);
        }
        return is_value_matching;
    });
}

function is_object(item) {
    return item && typeof item === "object" && !Array.isArray(item);
}

function deep_merge(target, source) {
    let output = Object.assign({}, target);
    let new_keys_added;
    if (is_object(target) && is_object(source)) {
        new_keys_added =
            new Set(Object.keys(target)).difference(new Set(Object.keys(source))).size != 0;

        Object.keys(source).forEach(key => {
            if (is_object(source[key])) {
                if (!(key in target)) {
                    Object.assign(output, { [key]: source[key] });
                } else {
                    const [merged_object, merged_keys_added] = deep_merge(target[key], source[key]);
                    output[key] = merged_object;
                    new_keys_added = new_keys_added || merged_keys_added;
                }
            } else {
                Object.assign(output, { [key]: source[key] });
            }
        });
    }
    return [output, new_keys_added];
}

export function use_object_local_storage(key, default_value) {
    const [current_value, set_value] = useLocalStorage(key, default_value);
    const [merged_value, should_update] = deep_merge(default_value, current_value);

    useEffect(() => {
        if (should_update) {
            set_value(merged_value);
        }
    }, [current_value]);

    return [merged_value, set_value];
}

export function km_to_miles(km) {
    const miles = km * 0.621371;
    return Math.round(miles);
}

export const get_max_radius = (center, spots) => {
    const center_maiden = new Maidenhead(center[1], center[0]);
    let max = 0;
    spots.forEach(spot => {
        const spot_maiden = new Maidenhead(spot.spotter_loc[1], spot.spotter_loc[0]);
        const dx_maiden = new Maidenhead(spot.dx_loc[1], spot.dx_loc[0]);
        const spoter_distance = center_maiden.distanceTo(spot_maiden);
        const dx_ditance = center_maiden.distanceTo(dx_maiden);
        max = Math.max(max, spoter_distance, dx_ditance);
    });

    return max;
};

export function get_base_url() {
    if (window.location.port == "5173") {
        return "http://holycluster-dev.iarc.org";
    } else {
        return "";
    }
}

export function sort_spots(spots, table_sort, radio_status = null, radio_band = null) {
    return [...spots].sort((spot_a, spot_b) => {
        // If sorting by frequency or band and CAT control is active, prioritize active band
        if (
            radio_status === "connected" &&
            (table_sort.column === "freq" || table_sort.column === "band")
        ) {
            const a_is_active = spot_a.band === radio_band;
            const b_is_active = spot_b.band === radio_band;

            if (a_is_active && !b_is_active) return -1;
            if (!a_is_active && b_is_active) return 1;
        }

        if (table_sort.column === "band") {
            const band_comparison = table_sort.ascending
                ? spot_a.band - spot_b.band
                : spot_b.band - spot_a.band;

            if (band_comparison !== 0) {
                return band_comparison;
            }

            // Within the same band, sort by time
            return spot_b.time - spot_a.time;
        }

        const column = table_sort.column;
        const value_a = spot_a[column];
        const value_b = spot_b[column];

        if (typeof value_a === "string" && typeof value_b === "string") {
            let comparison = table_sort.ascending
                ? value_a.localeCompare(value_b)
                : value_b.localeCompare(value_a);
            if (comparison === 0) {
                comparison = spot_b.time - spot_a.time;
            }
            return comparison;
        } else if (typeof value_a === "number" && typeof value_b === "number") {
            let comparison = table_sort.ascending ? value_a - value_b : value_b - value_a;

            // Secondary sorting by dx callsign and spotter callsign for consistent order
            if (comparison === 0) {
                comparison = spot_a.dx_callsign.localeCompare(spot_b.dx_callsign);
            }
            if (comparison === 0) {
                comparison = spot_a.spotter_callsign.localeCompare(spot_b.spotter_callsign);
            }
            return comparison;
        } else {
            console.log(
                `Bad values of column ${table_sort.column}`,
                value_a,
                value_b,
                spot_a,
                spot_b,
            );
            return 0;
        }
    });
}
