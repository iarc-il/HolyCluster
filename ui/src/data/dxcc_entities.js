import cty_dxcc_entities from "virtual:cty-dxcc-entities";
import {
    dxcc_code_entities as cty_dxcc_code_entities,
    dxcc_entities_by_code as cty_dxcc_entities_by_code,
} from "virtual:cty-dxcc-entities";
import { normalize_dxcc_entity_value, normalize_dxcc_label } from "@/data/dxcc_labels.js";

const USA_DXCC_CODES = new Set([291, 6, 110]);

export function normalize_dxcc_code(dxcc_code) {
    const text = (dxcc_code ?? "").toString().trim();
    if (!/^\d+$/.test(text)) return null;

    const code = Number(text);
    if (!Number.isSafeInteger(code) || code <= 0) return null;

    return code;
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

export function build_dxcc_entities_by_code(cty_entities_by_code, cty_code_entities = {}) {
    const entities_by_code = {};
    const source = Object.keys(cty_entities_by_code ?? {}).length
        ? cty_entities_by_code
        : Object.fromEntries(
              Object.entries(cty_code_entities ?? {}).map(([code, raw_cty_name]) => [
                  code,
                  { code: Number(code), raw_cty_name, continent: "" },
              ]),
          );

    for (const [dxcc_code, entity] of Object.entries(source)) {
        const normalized_code = normalize_dxcc_code(dxcc_code);
        const raw_cty_name = entity?.raw_cty_name ?? cty_code_entities?.[dxcc_code] ?? "";
        const label = normalize_dxcc_label(raw_cty_name);
        if (!normalized_code || !label) continue;

        entities_by_code[normalized_code] = {
            code: normalized_code,
            label,
            raw_cty_name,
            continent: entity?.continent ?? "",
        };
    }

    return entities_by_code;
}

export const dxcc_entities_by_code = build_dxcc_entities_by_code(
    cty_dxcc_entities_by_code,
    cty_dxcc_code_entities,
);
export const dxcc_entity_by_code = Object.fromEntries(
    Object.entries(dxcc_entities_by_code).map(([code, entity]) => [code, entity.label]),
);
export const dxcc_codes = Object.keys(dxcc_entities_by_code)
    .map(Number)
    .sort((a, b) => a - b);
export const dxcc_entities = (() => {
    const entities = new Set();
    for (const entity of cty_dxcc_entities) {
        const label = normalize_dxcc_label(entity);
        if (label) entities.add(label);
    }
    return Array.from(entities).sort((a, b) => a.localeCompare(b));
})();
export const dxcc_entity_options = dxcc_codes.map(code => ({
    value: code,
    label: dxcc_entities_by_code[code].label,
}));

const dxcc_codes_by_normalized_label = new Map();
for (const [code, entity] of Object.entries(dxcc_entities_by_code)) {
    dxcc_codes_by_normalized_label.set(
        normalize_dxcc_entity_value(entity.raw_cty_name),
        Number(code),
    );
    dxcc_codes_by_normalized_label.set(normalize_dxcc_entity_value(entity.label), Number(code));
}

export function get_dxcc_label(dxcc_code) {
    const normalized_code = normalize_dxcc_code(dxcc_code);
    if (!normalized_code) return "";
    return dxcc_entities_by_code[normalized_code]?.label ?? "";
}

export function get_dxcc_code_for_label(value) {
    const key = normalize_dxcc_entity_value(value);
    return dxcc_codes_by_normalized_label.get(key) ?? null;
}

export function normalize_dxcc_entity_code(value) {
    const code = normalize_dxcc_code(value);
    if (code && dxcc_entities_by_code[code]) return code;
    return get_dxcc_code_for_label(value);
}

export function is_filterable_dxcc_entity(value) {
    const code = normalize_dxcc_entity_code(value);
    return code != null && dxcc_entities_by_code[code] != null;
}

export function is_us_state_dxcc_code(dxcc_code) {
    const code = normalize_dxcc_code(dxcc_code);
    return code != null && USA_DXCC_CODES.has(code);
}

export function is_canada_dxcc_code(dxcc_code) {
    return normalize_dxcc_code(dxcc_code) === 1;
}
