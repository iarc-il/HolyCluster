import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CTY_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../backend/shared/src/shared/cty.csv",
);

const CTY_DXCC_FIELD_INDEX = 2;
const CTY_CONTINENT_FIELD_INDEX = 3;
const CTY_ALIAS_FIELD_INDEX = 9;

function parse_csv_line(line) {
    const values = [];
    let value = "";
    let quoted = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (quoted) {
            if (char === '"') {
                if (line[index + 1] === '"') {
                    value += '"';
                    index += 1;
                } else {
                    quoted = false;
                }
            } else {
                value += char;
            }
            continue;
        }

        if (char === '"') {
            quoted = true;
        } else if (char === ",") {
            values.push(value);
            value = "";
        } else {
            value += char;
        }
    }

    values.push(value);
    return values;
}

function parse_cty_rows(csv_text) {
    return csv_text
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(parse_csv_line);
}

function build_canonical_countries_by_dxcc(rows) {
    const canonical_countries = new Map();

    for (const row of rows) {
        if (row.length <= CTY_ALIAS_FIELD_INDEX) continue;

        const primary_prefix = row[0].trim();
        const country = row[1].trim();
        const dxcc_code = row[CTY_DXCC_FIELD_INDEX].trim();
        if (primary_prefix.startsWith("*") || !country || !dxcc_code) continue;

        if (!canonical_countries.has(dxcc_code)) {
            canonical_countries.set(dxcc_code, country);
        }
    }

    return canonical_countries;
}

function is_valid_dxcc_code(dxcc_code) {
    return /^\d+$/.test(dxcc_code);
}

export function parseCtyCountryNames(csv_text) {
    const rows = parse_cty_rows(csv_text);
    const canonical_countries_by_dxcc = build_canonical_countries_by_dxcc(rows);
    const country_names = new Set();

    for (const row of rows) {
        if (row.length <= CTY_ALIAS_FIELD_INDEX) continue;

        const primary_prefix = row[0].trim();
        const dxcc_code = row[CTY_DXCC_FIELD_INDEX].trim();
        let country = row[1].trim();
        const continent = row[CTY_CONTINENT_FIELD_INDEX].trim().toUpperCase();
        if (!country || !continent) continue;

        if (primary_prefix.startsWith("*")) {
            country = canonical_countries_by_dxcc.get(dxcc_code) ?? country;
        }

        country_names.add(country);
    }

    return Array.from(country_names).sort((a, b) => a.localeCompare(b));
}

export function parseCtyDxccCodeEntities(csv_text) {
    return Object.fromEntries(
        Object.entries(parseCtyDxccEntities(csv_text)).map(([dxcc_code, entity]) => [
            dxcc_code,
            entity.raw_cty_name,
        ]),
    );
}

export function parseCtyDxccEntities(csv_text) {
    const rows = parse_cty_rows(csv_text);
    const canonical_countries_by_dxcc = build_canonical_countries_by_dxcc(rows);

    return Object.fromEntries(
        Array.from(canonical_countries_by_dxcc.entries())
            .filter(([dxcc_code]) => is_valid_dxcc_code(dxcc_code))
            .map(([dxcc_code, raw_cty_name]) => {
                const row = rows.find(
                    candidate =>
                        candidate.length > CTY_ALIAS_FIELD_INDEX &&
                        !candidate[0].trim().startsWith("*") &&
                        candidate[CTY_DXCC_FIELD_INDEX].trim() === dxcc_code,
                );
                return [
                    dxcc_code,
                    {
                        code: Number(dxcc_code),
                        raw_cty_name,
                        continent: row?.[CTY_CONTINENT_FIELD_INDEX]?.trim().toUpperCase() ?? "",
                    },
                ];
            })
            .sort(([code_a], [code_b]) => Number(code_a) - Number(code_b)),
    );
}

export async function loadCtyDxccData() {
    const csv_text = await fs.readFile(CTY_PATH, "utf8");
    const cache_result = {
        path: CTY_PATH,
        available: true,
        downloaded: false,
        message: "loaded committed file",
    };

    return {
        cache_result,
        country_names: parseCtyCountryNames(csv_text),
        dxcc_entities: parseCtyDxccEntities(csv_text),
        dxcc_code_entities: parseCtyDxccCodeEntities(csv_text),
    };
}

export async function loadCtyCountryNames() {
    const { cache_result, country_names } = await loadCtyDxccData();
    return { cache_result, country_names };
}

export const VIRTUAL_CTY_DXCC_ENTITIES_MODULE_ID = "virtual:cty-dxcc-entities";

export function ctyDxccEntitiesPlugin() {
    const resolved_virtual_module_id = `\0${VIRTUAL_CTY_DXCC_ENTITIES_MODULE_ID}`;

    return {
        name: "cty-dxcc-entities",
        resolveId(id) {
            if (id === VIRTUAL_CTY_DXCC_ENTITIES_MODULE_ID) return resolved_virtual_module_id;
            return null;
        },
        async load(id) {
            if (id !== resolved_virtual_module_id) return null;

            const { cache_result, country_names, dxcc_entities, dxcc_code_entities } =
                await loadCtyDxccData();
            this.info(`Loaded committed CTY file for DXCC entity labels: ${cache_result.path}`);

            // The browser bundle receives only derived CTY data, never cty.csv.
            return [
                `export const dxcc_entities_by_code = ${JSON.stringify(dxcc_entities)};`,
                `export const dxcc_code_entities = ${JSON.stringify(dxcc_code_entities)};`,
                `export default ${JSON.stringify(country_names)};`,
                "",
            ].join("\n");
        },
    };
}
