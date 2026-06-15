import {
    is_canada_dxcc_code,
    is_filterable_dxcc_entity,
    is_us_state_dxcc_code,
    normalize_dxcc_entity_code,
} from "@/data/dxcc_entities.js";
import {
    HUNTER_SECTION_KEYS,
    create_default_hunter,
    sanitize_hunter,
} from "@/utils/profile_data.js";
import { find_zone_number, is_valid_zone_number, normalize_zone_value } from "@/utils/zones.js";
import { AdifParser } from "adif-parser-ts";

export const HUNTER_ADIF_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const HUNTER_ADIF_MAX_QSO_RECORDS = 50_000;
export const HUNTER_RESOLVE_BATCH_SIZE = 100;
export const HUNTER_IMPORT_PHASES = Object.freeze({
    PARSING: "parsing",
    PROCESSING: "processing",
    RESOLVING: "resolving",
    MERGING: "merging",
    COMPLETE: "complete",
});

const HUNTER_IMPORT_COUNT_KEYS = ["dxcc", "cq_zone", "itu_zone", "us_state", "ca_province"];

const ADIF_EMPTY_ERROR_MESSAGE = "ADIF file is empty.";
const ADIF_NOT_ADIF_ERROR_MESSAGE =
    "Selected file does not look like an ADIF file. Make sure it is a text .adi or .adif export.";
const ADIF_PARSE_ERROR_MESSAGE =
    "Could not parse ADIF file. Make sure it is a text .adi or .adif export.";
const ADIF_NO_QSO_ERROR_MESSAGE = "ADIF file does not contain any QSO records.";

export class HunterAdifImportError extends Error {
    constructor(message) {
        super(message);
        this.name = "HunterAdifImportError";
    }
}

function get_field(record, field_names) {
    for (const field_name of field_names) {
        const value = record[field_name];
        if (value == null) continue;

        const text = value.toString().trim();
        if (text.length > 0) return text;
    }
    return "";
}

function normalize_callsign(callsign) {
    return callsign.toString().trim().toUpperCase();
}

function normalize_country(country) {
    const code = normalize_dxcc_entity_code(country);
    return code != null && is_filterable_dxcc_entity(code) ? code : null;
}

function normalize_number_feature(section, value) {
    const normalized = normalize_zone_value(section, value);
    return is_valid_zone_number(section, normalized) ? normalized : null;
}

function get_state_section(country) {
    if (is_us_state_dxcc_code(country)) return "us_state";
    if (is_canada_dxcc_code(country)) return "ca_province";
    return null;
}

function normalize_state_feature(country, state) {
    const section = get_state_section(country);
    if (!section) return null;

    const value = normalize_zone_value(section, state);
    if (!is_valid_zone_number(section, value)) return null;

    return { section, value };
}

function add_feature(features, section, value) {
    if (value == null) return;
    features[section] = value;
}

function create_empty_feature_sets() {
    return Object.fromEntries(HUNTER_SECTION_KEYS.map(section => [section, new Set()]));
}

function create_empty_added_counts() {
    return Object.fromEntries(HUNTER_IMPORT_COUNT_KEYS.map(section => [section, 0]));
}

function extract_direct_record_features(record) {
    const features = {};
    const dxcc_code = get_field(record, ["dxcc"]);
    const country = get_field(record, ["country"]);
    const dxcc_entity = dxcc_code ? normalize_dxcc_entity_code(dxcc_code) : null;
    const country_entity = country ? normalize_country(country) : null;
    const conflict = Boolean(dxcc_entity && country_entity && dxcc_entity !== country_entity);
    const record_country = dxcc_entity ?? country_entity;

    if (dxcc_entity) {
        add_feature(features, "dxcc", dxcc_entity);
    } else if (country_entity) {
        add_feature(features, "dxcc", country_entity);
    }

    add_feature(
        features,
        "cq_zone",
        normalize_number_feature("cq", get_field(record, ["cq", "cqz"])),
    );
    add_feature(
        features,
        "itu_zone",
        normalize_number_feature("itu", get_field(record, ["itu", "ituz"])),
    );

    const state_feature = normalize_state_feature(record_country, get_field(record, ["state"]));
    if (state_feature) {
        add_feature(features, state_feature.section, state_feature.value);
    }

    return {
        call: normalize_callsign(get_field(record, ["call"])),
        country: record_country,
        conflict,
        features,
    };
}

function record_needs_resolution(direct_record) {
    if (!direct_record.call) return false;
    if (!direct_record.country) return true;
    if (!direct_record.features.dxcc) return true;
    if (!direct_record.features.cq_zone) return true;
    if (!direct_record.features.itu_zone) return true;

    const state_section = get_state_section(direct_record.country);
    return Boolean(state_section && !direct_record.features[state_section]);
}

function is_finite_coordinate(value) {
    return Number.isFinite(Number(value));
}

function get_resolved_coordinate_state(country, resolved) {
    const section = get_state_section(country);
    if (!section || !is_finite_coordinate(resolved.lon) || !is_finite_coordinate(resolved.lat)) {
        return null;
    }

    const value = find_zone_number(section, [Number(resolved.lon), Number(resolved.lat)]);
    return is_valid_zone_number(section, value) ? { section, value } : null;
}

function merge_resolved_record_features(direct_record, resolved) {
    const features = { ...direct_record.features };
    if (!resolved) return features;

    const resolved_country =
        normalize_dxcc_entity_code(resolved.dxcc_code) ?? normalize_country(resolved.country);
    const state_country = resolved_country ?? direct_record.country;

    if (!features.dxcc && resolved_country) {
        add_feature(features, "dxcc", resolved_country);
    }
    if (!features.cq_zone) {
        add_feature(features, "cq_zone", normalize_number_feature("cq", resolved.cq_zone));
    }
    if (!features.itu_zone) {
        add_feature(features, "itu_zone", normalize_number_feature("itu", resolved.itu_zone));
    }

    if (!features.us_state && !features.ca_province) {
        const state_feature =
            normalize_state_feature(state_country, resolved.state) ??
            get_resolved_coordinate_state(state_country, resolved);
        if (state_feature) {
            add_feature(features, state_feature.section, state_feature.value);
        }
    }

    return features;
}

function add_record_features(feature_sets, features) {
    for (const section of HUNTER_SECTION_KEYS) {
        if (features[section] != null) {
            feature_sets[section].add(features[section]);
        }
    }
}

function merge_hunter_worked(hunter, feature_sets) {
    const source = sanitize_hunter(hunter ?? create_default_hunter());
    const added_counts = create_empty_added_counts();
    const worked = {};

    for (const section of HUNTER_SECTION_KEYS) {
        const existing = source.worked[section]?.global ?? [];
        const values = [...existing];
        const known = new Set(existing);

        for (const value of feature_sets[section]) {
            if (known.has(value)) continue;
            known.add(value);
            values.push(value);
            added_counts[section] += 1;
        }

        worked[section] = { global: values };
    }

    return {
        hunter: {
            ...source,
            worked,
        },
        added_counts,
    };
}

export function parse_hunter_adif_records(adif_text) {
    try {
        const parsed = new AdifParser(adif_text).parseTopLevel();
        return Array.isArray(parsed.records) ? parsed.records : [];
    } catch (_error) {
        throw new HunterAdifImportError(ADIF_PARSE_ERROR_MESSAGE);
    }
}

function looks_like_adif_text(adif_text) {
    return /<\s*eo[hr]\s*>/i.test(adif_text) || /<\s*[a-z][a-z0-9_]*\s*:\s*\d+/i.test(adif_text);
}

function validate_adif_text(adif_text) {
    if (adif_text.trim().length === 0) {
        throw new HunterAdifImportError(ADIF_EMPTY_ERROR_MESSAGE);
    }
    if (!looks_like_adif_text(adif_text)) {
        throw new HunterAdifImportError(ADIF_NOT_ADIF_ERROR_MESSAGE);
    }
}

function validate_import_limits({ file_size, record_count }) {
    if (file_size != null && file_size > HUNTER_ADIF_MAX_FILE_SIZE_BYTES) {
        throw new HunterAdifImportError("ADIF file is too large. Maximum size is 10 MB.");
    }
    if (record_count > HUNTER_ADIF_MAX_QSO_RECORDS) {
        throw new HunterAdifImportError("ADIF file has too many QSO records. Maximum is 50,000.");
    }
}

function validate_adif_records(records) {
    if (records.length === 0) {
        throw new HunterAdifImportError(ADIF_NO_QSO_ERROR_MESSAGE);
    }
}

export async function resolve_hunter_callsigns(callsigns) {
    const response = await fetch("/hunter/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callsigns }),
    });

    if (!response.ok) {
        throw new Error(`Hunter resolver failed with HTTP ${response.status}`);
    }

    return response.json();
}

function report_import_progress(on_progress, progress) {
    if (typeof on_progress !== "function") return;

    on_progress(progress);
}

function report_resolve_progress(on_progress, completed, total) {
    const percentage = total === 0 ? 100 : Math.round((completed / total) * 100);
    report_import_progress(on_progress, {
        phase: HUNTER_IMPORT_PHASES.RESOLVING,
        completed,
        total,
        percentage,
    });
}

async function resolve_callsign_batches(callsigns, resolve_batch, on_progress) {
    const results = {};
    const errors = {};
    report_resolve_progress(on_progress, 0, callsigns.length);

    for (let index = 0; index < callsigns.length; index += HUNTER_RESOLVE_BATCH_SIZE) {
        const batch = callsigns.slice(index, index + HUNTER_RESOLVE_BATCH_SIZE);
        try {
            const resolved = await resolve_batch(batch);
            Object.assign(results, resolved?.results ?? {});
            Object.assign(errors, resolved?.errors ?? {});
        } catch (error) {
            for (const callsign of batch) {
                errors[callsign] = error.message;
            }
        }
        report_resolve_progress(
            on_progress,
            Math.min(index + HUNTER_RESOLVE_BATCH_SIZE, callsigns.length),
            callsigns.length,
        );
    }

    return { results, errors };
}

export async function import_hunter_adif({
    hunter = create_default_hunter(),
    adif_text,
    file_name = "ADIF import",
    file_size = null,
    imported_at = Math.floor(Date.now() / 1000),
    resolve_callsigns = resolve_hunter_callsigns,
    on_progress = null,
} = {}) {
    validate_import_limits({ file_size, record_count: 0 });

    report_import_progress(on_progress, { phase: HUNTER_IMPORT_PHASES.PARSING });
    const source_adif_text = adif_text ?? "";
    validate_adif_text(source_adif_text);
    const records = parse_hunter_adif_records(source_adif_text);
    validate_import_limits({ file_size, record_count: records.length });
    validate_adif_records(records);

    report_import_progress(on_progress, { phase: HUNTER_IMPORT_PHASES.PROCESSING });
    const direct_records = records.map(extract_direct_record_features);
    const conflict_count = direct_records.filter(record => record.conflict).length;
    const callsigns_to_resolve = Array.from(
        new Set(direct_records.filter(record_needs_resolution).map(record => record.call)),
    );
    const resolved = await resolve_callsign_batches(
        callsigns_to_resolve,
        resolve_callsigns,
        on_progress,
    );
    report_import_progress(on_progress, { phase: HUNTER_IMPORT_PHASES.MERGING });
    const feature_sets = create_empty_feature_sets();
    let skipped_count = 0;

    for (const direct_record of direct_records) {
        const features = merge_resolved_record_features(
            direct_record,
            resolved.results[direct_record.call],
        );
        if (Object.keys(features).length === 0 && !direct_record.call) {
            skipped_count += 1;
        }
        add_record_features(feature_sets, features);
    }

    const merged = merge_hunter_worked(hunter, feature_sets);
    const unresolved_count = callsigns_to_resolve.filter(
        callsign => !resolved.results[callsign],
    ).length;
    const metadata = {
        file_name,
        imported_at,
        qso_count: records.length,
        added_counts: merged.added_counts,
        skipped_count,
        resolved_count: callsigns_to_resolve.length - unresolved_count,
        unresolved_count,
        conflict_count,
    };

    const result = {
        hunter: {
            ...merged.hunter,
            imports: [...merged.hunter.imports, metadata],
        },
        metadata,
        resolver_errors: resolved.errors,
    };

    report_import_progress(on_progress, {
        phase: HUNTER_IMPORT_PHASES.COMPLETE,
        percentage: 100,
    });

    return result;
}
