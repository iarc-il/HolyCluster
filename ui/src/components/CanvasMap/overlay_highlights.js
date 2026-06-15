import {
    dxcc_codes,
    is_filterable_dxcc_entity,
    normalize_dxcc_entity_code,
} from "@/data/dxcc_entities.js";
import { create_default_hunter, sanitize_hunter } from "@/utils/profile_data.js";
import { get_valid_zone_values, normalize_zone_value } from "@/utils/zones.js";

const HUNTER_SECTION_OVERLAYS = {
    dxcc: {
        type: "dxcc",
        values: () => dxcc_codes,
        normalize: normalize_dxcc_entity_code,
    },
    cq_zone: {
        type: "zone",
        system: "cq",
        values: () => get_valid_zone_values("cq"),
        normalize: value => normalize_zone_value("cq", value),
    },
    itu_zone: {
        type: "zone",
        system: "itu",
        values: () => get_valid_zone_values("itu"),
        normalize: value => normalize_zone_value("itu", value),
    },
    us_state: {
        type: "zone",
        system: "us_state",
        values: () => get_valid_zone_values("us_state"),
        normalize: value => normalize_zone_value("us_state", value),
    },
    ca_province: {
        type: "zone",
        system: "ca_province",
        values: () => get_valid_zone_values("ca_province"),
        normalize: value => normalize_zone_value("ca_province", value),
    },
};

const ZONE_SYSTEMS = ["cq", "itu", "us_state", "ca_province"];

function create_empty_overlay_highlights() {
    return {
        dxcc: new Map(),
        zones: Object.fromEntries(ZONE_SYSTEMS.map(system => [system, new Map()])),
        key: "",
    };
}

function add_dxcc_highlight(highlights, value, action) {
    if (!is_filterable_dxcc_entity(value)) return;

    const entity = normalize_dxcc_entity_code(value);
    if (entity) highlights.dxcc.set(entity, action);
}

function add_zone_highlight(highlights, system, value, action) {
    const normalized_value = normalize_zone_value(system, value);
    if (normalized_value == null) return;

    highlights.zones[system]?.set(normalized_value, action);
}

function serialize_action_map(action_map) {
    return Array.from(action_map.entries())
        .sort(([value_a], [value_b]) => String(value_a).localeCompare(String(value_b)))
        .map(([value, action]) => `${value}:${action}`)
        .join(",");
}

function get_overlay_highlights_key(highlights) {
    return [
        `dxcc=${serialize_action_map(highlights.dxcc)}`,
        ...ZONE_SYSTEMS.map(
            system => `${system}=${serialize_action_map(highlights.zones[system])}`,
        ),
    ].join("|");
}

function get_worked_values(hunter, section, normalize) {
    return new Set(
        (hunter.worked[section]?.global ?? [])
            .map(value => normalize(value))
            .filter(value => value != null),
    );
}

export function build_hunter_overlay_highlights(hunter) {
    const highlights = create_empty_overlay_highlights();
    const source = sanitize_hunter(hunter ?? create_default_hunter());

    for (const [section, overlay] of Object.entries(HUNTER_SECTION_OVERLAYS)) {
        if (!source.enabled_sections[section]) continue;

        const worked_values = get_worked_values(source, section, overlay.normalize);
        for (const value of overlay.values()) {
            const normalized_value = overlay.normalize(value);
            if (normalized_value == null || worked_values.has(normalized_value)) continue;

            if (overlay.type === "dxcc") {
                add_dxcc_highlight(highlights, value, "alert");
            } else {
                add_zone_highlight(highlights, overlay.system, value, "alert");
            }
        }
    }

    highlights.key = get_overlay_highlights_key(highlights);
    return highlights;
}
