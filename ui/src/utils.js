import { useLocalStorage } from "@uidotdev/usehooks";
import { useEffect } from "react";

export function to_radian(deg) {
    return deg * (Math.PI / 180);
}

export const mod = (n, m) => ((n % m) + m) % m;

export function is_matching_list(list, spot) {
    return list.some(filter => {
        let matched_value;
        if (filter.spotter_or_dx == "spotter") {
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
        if (filter.type == "prefix") {
            is_value_matching = matched_value.startsWith(filter.value);
        } else if (filter.type == "suffix") {
            is_value_matching = matched_value.endsWith(filter.value);
        } else if (filter.type == "entity") {
            is_value_matching = matched_value == filter.value;
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
