import { get_dxcc_label, normalize_dxcc_entity_code } from "@/data/dxcc_entities.js";

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
