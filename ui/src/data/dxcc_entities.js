import cty_dxcc_entities from "virtual:cty-dxcc-entities";
import { normalize_dxcc_entity_value, normalize_dxcc_label } from "@/data/dxcc_labels.js";

function build_dxcc_entities(cty_entities) {
    const entities = new Set();

    for (const entity of cty_entities) {
        const label = normalize_dxcc_label(entity);
        if (label) entities.add(label);
    }

    return Array.from(entities).sort((a, b) => a.localeCompare(b));
}

export const dxcc_entities = build_dxcc_entities(cty_dxcc_entities);
export const dxcc_entity_options = dxcc_entities.map(entity => ({ value: entity, label: entity }));

const filterable_dxcc_entity_values = new Set(
    dxcc_entities.map(entity => normalize_dxcc_entity_value(entity)),
);

export function is_filterable_dxcc_entity(entity) {
    return filterable_dxcc_entity_values.has(normalize_dxcc_entity_value(entity));
}
