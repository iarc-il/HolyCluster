import cty_dxcc_entities from "virtual:cty-dxcc-entities";
import { dxcc_code_entities as cty_dxcc_code_entities } from "virtual:cty-dxcc-entities";
import { normalize_dxcc_entity_value, normalize_dxcc_label } from "@/data/dxcc_labels.js";

function build_dxcc_entities(cty_entities) {
    const entities = new Set();

    for (const entity of cty_entities) {
        const label = normalize_dxcc_label(entity);
        if (label) entities.add(label);
    }

    return Array.from(entities).sort((a, b) => a.localeCompare(b));
}

function normalize_dxcc_code(dxcc_code) {
    const text = (dxcc_code ?? "").toString().trim();
    if (!/^\d+$/.test(text)) return null;

    const code = Number(text);
    if (!Number.isSafeInteger(code) || code <= 0) return null;

    return code.toString();
}

export function build_dxcc_entity_by_code(cty_code_entities) {
    const entities_by_code = {};

    for (const [dxcc_code, entity] of Object.entries(cty_code_entities ?? {})) {
        const normalized_code = normalize_dxcc_code(dxcc_code);
        const label = normalize_dxcc_label(entity);
        if (normalized_code && label) {
            entities_by_code[normalized_code] = label;
        }
    }

    return entities_by_code;
}

export const dxcc_entities = build_dxcc_entities(cty_dxcc_entities);
export const dxcc_entity_options = dxcc_entities.map(entity => ({ value: entity, label: entity }));
export const dxcc_entity_by_code = build_dxcc_entity_by_code(cty_dxcc_code_entities);

const filterable_dxcc_entity_values = new Set(
    dxcc_entities.map(entity => normalize_dxcc_entity_value(entity)),
);

export function is_filterable_dxcc_entity(entity) {
    return filterable_dxcc_entity_values.has(normalize_dxcc_entity_value(entity));
}

export function get_dxcc_entity_for_code(dxcc_code) {
    const normalized_code = normalize_dxcc_code(dxcc_code);
    if (!normalized_code) return null;
    return dxcc_entity_by_code[normalized_code] ?? null;
}
