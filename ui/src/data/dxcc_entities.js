import prefix_list_csv from "../../../backend/shared/src/shared/prefixes_list.csv?raw";
import { shorten_dxcc } from "@/data/flags.js";

function normalize_dxcc_entity_value(value) {
    return (value ?? "").toString().trim().toLowerCase();
}

function parse_prefix_list_entities(csv_text) {
    const entities = new Set();

    for (const line of csv_text.split("\n")) {
        const match = line.match(/^"([^"]*)","([^"]*)","([^"]*)","([^"]*)"$/);
        const entity = match?.[3];
        if (entity) entities.add(shorten_dxcc(entity));
    }

    return Array.from(entities).sort();
}

export const dxcc_entities = parse_prefix_list_entities(prefix_list_csv);
export const dxcc_entity_options = dxcc_entities.map(entity => ({ value: entity, label: entity }));

const filterable_dxcc_entity_values = new Set(
    dxcc_entities.map(entity => normalize_dxcc_entity_value(entity)),
);

export function is_filterable_dxcc_entity(entity) {
    return filterable_dxcc_entity_values.has(normalize_dxcc_entity_value(entity));
}
