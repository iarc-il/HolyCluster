import {
    get_dxcc_label,
    is_canada_dxcc_code,
    is_us_state_dxcc_code,
    normalize_dxcc_entity_code,
} from "@/data/dxcc_entities.js";
import { annotateDiagnosticError } from "@/sentry.js";

export function get_spot_dxcc_display(spot, spot_source) {
    const value = spot.dx_dxcc_code;
    let predicate = "label";
    try {
        const dx_label = get_dxcc_label(value) || spot.dx_country || "";
        predicate = "us_state";
        const is_us_state_entity = is_us_state_dxcc_code(value);
        predicate = "canada";
        const is_canada_entity = is_canada_dxcc_code(value);
        return { dx_label, is_us_state_entity, is_canada_entity };
    } catch (error) {
        try {
            annotateDiagnosticError(error, {
                operation: "spot_render",
                dxcc_failure_field: "dx_dxcc_code",
                dxcc_failure_predicate: predicate,
                dxcc_input_type: value === null ? "null" : typeof value,
                dxcc_input_length: typeof value === "string" ? value.length : null,
                dxcc_input_positive_integer:
                    typeof value === "number" ? Number.isInteger(value) && value > 0 : null,
                spot_source,
            });
        } catch {}
        throw error;
    }
}

export function normalize_spot_dxcc_fields(spot) {
    const dx_dxcc_code = normalize_dxcc_entity_code(spot.dx_dxcc_code ?? spot.dx_country);
    const spotter_dxcc_code = normalize_dxcc_entity_code(
        spot.spotter_dxcc_code ?? spot.spotter_country,
    );

    return {
        ...spot,
        dx_dxcc_code,
        spotter_dxcc_code,
        dx_country: get_dxcc_label(dx_dxcc_code),
        spotter_country: get_dxcc_label(spotter_dxcc_code),
    };
}
