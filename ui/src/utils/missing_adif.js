import {
    is_canada_dxcc_code,
    is_filterable_dxcc_entity,
    is_us_state_dxcc_code,
    normalize_dxcc_entity_code,
} from "@/data/dxcc_entities.js";
import { MISSING_SECTION_KEYS } from "@/data/missing_sections.js";
import { create_default_missing, sanitize_missing } from "@/utils/profile_data.js";
import { find_zone_number, is_valid_zone_number, normalize_zone_value } from "@/utils/zones.js";
import { AdifParser } from "adif-parser-ts";

export const MISSING_ADIF_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const MISSING_RESOLVE_WS_CHUNK_SIZE = 500;
const MISSING_RESOLVE_MAX_ATTEMPTS = 3;
const MISSING_RESOLVE_WS_PROBE_TIMEOUT_MS = 1500;
const WS_PROTOCOL_VERSION = 1;
export const MISSING_IMPORT_PHASES = Object.freeze({
    PARSING: "parsing",
    PROCESSING: "processing",
    RESOLVING: "resolving",
    MERGING: "merging",
    COMPLETE: "complete",
});

const MISSING_IMPORT_COUNT_KEYS = ["dxcc", "cq_zone", "itu_zone", "us_state", "ca_province"];

const ADIF_EMPTY_ERROR_MESSAGE = "ADIF file is empty.";
const ADIF_NOT_ADIF_ERROR_MESSAGE =
    "Selected file does not look like an ADIF file. Make sure it is a text .adi or .adif export.";
const ADIF_PARSE_ERROR_MESSAGE =
    "Could not parse ADIF file. Make sure it is a text .adi or .adif export.";
const ADIF_NO_QSO_ERROR_MESSAGE = "ADIF file does not contain any QSO records.";

export class MissingAdifImportError extends Error {
    constructor(message) {
        super(message);
        this.name = "MissingAdifImportError";
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
    return Object.fromEntries(MISSING_SECTION_KEYS.map(section => [section, new Set()]));
}

function create_empty_added_counts() {
    return Object.fromEntries(MISSING_IMPORT_COUNT_KEYS.map(section => [section, 0]));
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
    for (const section of MISSING_SECTION_KEYS) {
        if (features[section] != null) {
            feature_sets[section].add(features[section]);
        }
    }
}

function merge_missing_worked(missing, feature_sets) {
    const source = sanitize_missing(missing ?? create_default_missing());
    const added_counts = create_empty_added_counts();
    const worked = {};

    for (const section of MISSING_SECTION_KEYS) {
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
        missing: {
            ...source,
            worked,
        },
        added_counts,
    };
}

export function parse_missing_adif_records(adif_text) {
    try {
        const parsed = new AdifParser(adif_text).parseTopLevel();
        return Array.isArray(parsed.records) ? parsed.records : [];
    } catch (_error) {
        throw new MissingAdifImportError(ADIF_PARSE_ERROR_MESSAGE);
    }
}

function looks_like_adif_text(adif_text) {
    return /<\s*eo[hr]\s*>/i.test(adif_text) || /<\s*[a-z][a-z0-9_]*\s*:\s*\d+/i.test(adif_text);
}

function validate_adif_text(adif_text) {
    if (adif_text.trim().length === 0) {
        throw new MissingAdifImportError(ADIF_EMPTY_ERROR_MESSAGE);
    }
    if (!looks_like_adif_text(adif_text)) {
        throw new MissingAdifImportError(ADIF_NOT_ADIF_ERROR_MESSAGE);
    }
}

function validate_import_limits({ file_size }) {
    if (file_size != null && file_size > MISSING_ADIF_MAX_FILE_SIZE_BYTES) {
        throw new MissingAdifImportError("ADIF file is too large. Maximum size is 50 MB.");
    }
}

function validate_adif_records(records) {
    if (records.length === 0) {
        throw new MissingAdifImportError(ADIF_NO_QSO_ERROR_MESSAGE);
    }
}

function resolve_missing_callsigns_once(callsigns, pending, results, errors, on_progress) {
    return new Promise((resolve, reject) => {
        const job_id =
            typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                ? crypto.randomUUID()
                : `${Date.now()}:${Math.random()}`;
        const location = globalThis.location;
        if (!location?.host) throw new Error("Missing resolver websocket host");

        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const base_url = `${protocol}//${location.host}`;
        let socket;
        let probe_timeout;
        let fallback_started = false;
        let completed = false;

        function clear_probe_timeout() {
            clearTimeout(probe_timeout);
            probe_timeout = undefined;
        }

        function fail(error) {
            if (completed) return;
            completed = true;
            clear_probe_timeout();
            socket.close();
            reject(error);
        }

        function connect(path, allow_fallback) {
            const candidate = new WebSocket(`${base_url}${path}`);
            let opened = false;
            socket = candidate;

            function send(data) {
                candidate.send(
                    JSON.stringify({ version: WS_PROTOCOL_VERSION, type: "missing", ...data }),
                );
            }

            function start_fallback() {
                if (!allow_fallback || fallback_started || completed || socket !== candidate)
                    return;
                fallback_started = true;
                clear_probe_timeout();
                candidate.onclose = null;
                candidate.onerror = null;
                candidate.close();
                connect("/submit_spot", false);
            }

            candidate.onopen = () => {
                if (socket !== candidate) return;
                opened = true;
                clear_probe_timeout();
                send({ action: "start", job_id });
                for (
                    let index = 0;
                    index < callsigns.length;
                    index += MISSING_RESOLVE_WS_CHUNK_SIZE
                ) {
                    send({
                        action: "add",
                        job_id,
                        callsigns: callsigns.slice(index, index + MISSING_RESOLVE_WS_CHUNK_SIZE),
                    });
                }
                send({ action: "finish", job_id });
            };

            candidate.onmessage = event => {
                if (socket !== candidate) return;
                let message;
                try {
                    message = JSON.parse(event.data);
                } catch (error) {
                    fail(error);
                    return;
                }

                if (message.type === "error") {
                    fail(new Error(message.message || "Missing resolver failed."));
                    return;
                }
                if (message.type !== "missing" || message.job_id !== job_id) return;

                if (message.event === "results") {
                    for (const [callsign, result] of Object.entries(message.results ?? {})) {
                        results[callsign] = result;
                        pending.delete(callsign);
                    }
                    for (const [callsign, error] of Object.entries(message.errors ?? {})) {
                        errors[callsign] = error;
                        pending.delete(callsign);
                    }
                    on_progress?.();
                    return;
                }
                if (message.event === "complete") {
                    completed = true;
                    clear_probe_timeout();
                    candidate.close();
                    resolve();
                }
            };

            candidate.onerror = () => {
                if (allow_fallback && !opened) {
                    start_fallback();
                } else {
                    fail(new Error("Missing resolver websocket failed."));
                }
            };
            candidate.onclose = () => {
                if (socket !== candidate || completed) return;
                if (allow_fallback && !opened) {
                    start_fallback();
                } else {
                    fail(new Error("Missing resolver websocket disconnected."));
                }
            };

            if (allow_fallback) {
                probe_timeout = setTimeout(start_fallback, MISSING_RESOLVE_WS_PROBE_TIMEOUT_MS);
            }
        }

        connect("/ws", true);
    });
}

export async function resolve_missing_callsigns(callsigns, on_progress) {
    const results = {};
    const errors = {};
    const pending = new Set(callsigns);
    const total = callsigns.length;
    let attempts = 0;
    let last_completed = -1;

    function report_completed(completed) {
        if (completed === last_completed) return;
        last_completed = completed;
        on_progress?.(completed);
    }

    while (pending.size > 0 && attempts < MISSING_RESOLVE_MAX_ATTEMPTS) {
        attempts += 1;
        try {
            await resolve_missing_callsigns_once([...pending], pending, results, errors, () => {
                report_completed(total - pending.size);
            });
        } catch (_error) {
            if (pending.size === 0) break;
        }
    }

    for (const callsign of pending) {
        errors[callsign] = "resolver disconnected";
    }
    pending.clear();
    report_completed(total);

    return { results, errors };
}

function report_import_progress(on_progress, progress) {
    if (typeof on_progress !== "function") return;

    on_progress(progress);
}

function report_resolve_progress(on_progress, completed, total) {
    const percentage = total === 0 ? 100 : Math.round((completed / total) * 100);
    report_import_progress(on_progress, {
        phase: MISSING_IMPORT_PHASES.RESOLVING,
        completed,
        total,
        percentage,
    });
}

async function resolve_callsigns_for_import(callsigns, resolve_callsigns, on_progress) {
    const total = callsigns.length;
    let last_completed = -1;

    function report_completed(completed) {
        if (completed === last_completed) return;
        last_completed = completed;
        report_resolve_progress(on_progress, completed, total);
    }

    report_completed(0);
    try {
        const resolved = await resolve_callsigns(callsigns, report_completed);
        report_completed(total);
        return { results: resolved?.results ?? {}, errors: resolved?.errors ?? {} };
    } catch (error) {
        report_completed(total);
        return {
            results: {},
            errors: Object.fromEntries(callsigns.map(callsign => [callsign, error.message])),
        };
    }
}

export async function import_missing_adif({
    missing = create_default_missing(),
    adif_text,
    file_name = "ADIF import",
    file_size = null,
    imported_at = Math.floor(Date.now() / 1000),
    resolve_callsigns = resolve_missing_callsigns,
    on_progress = null,
} = {}) {
    validate_import_limits({ file_size });

    report_import_progress(on_progress, { phase: MISSING_IMPORT_PHASES.PARSING });
    const source_adif_text = adif_text ?? "";
    validate_adif_text(source_adif_text);
    const records = parse_missing_adif_records(source_adif_text);
    validate_adif_records(records);

    report_import_progress(on_progress, { phase: MISSING_IMPORT_PHASES.PROCESSING });
    const direct_records = records.map(extract_direct_record_features);
    const conflict_count = direct_records.filter(record => record.conflict).length;
    const callsigns_to_resolve = Array.from(
        new Set(direct_records.filter(record_needs_resolution).map(record => record.call)),
    );
    const resolved = await resolve_callsigns_for_import(
        callsigns_to_resolve,
        resolve_callsigns,
        on_progress,
    );
    report_import_progress(on_progress, { phase: MISSING_IMPORT_PHASES.MERGING });
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

    const merged = merge_missing_worked(missing, feature_sets);
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
        missing: {
            ...merged.missing,
            imports: [...merged.missing.imports, metadata],
        },
        metadata,
        resolver_errors: resolved.errors,
    };

    report_import_progress(on_progress, {
        phase: MISSING_IMPORT_PHASES.COMPLETE,
        percentage: 100,
    });

    return result;
}
