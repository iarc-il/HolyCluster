import { bands, continents, modes } from "@/data/filters_data.js";

const KEY = "live_spot_snapshot_v2";
const MAX_AGE_MS = 5 * 60 * 1000;
const MAX_SPOTS = 500;
const MAX_BYTES = 512 * 1024;
const MAX_RECORD_BYTES = 8192;
const STRING_FIELDS = [
    "comment",
    "dx_country",
    "spotter_country",
    "dx_state",
    "spotter_state",
    "type",
    "dx_lotw_status",
    "pota_reference",
    "pota_name",
    "pota_description",
];
const NUMBER_FIELDS = [
    "dx_cq_zone",
    "dx_itu_zone",
    "spotter_cq_zone",
    "spotter_itu_zone",
    "sota_points",
];
const encoder = new TextEncoder();
let pending = [];
let scheduled = false;
let writing = false;
let drain_promise = null;
let resolve_drain;
let drain_succeeded = true;

function byte_size(text) {
    return Math.max(text.length * 2, encoder.encode(text).length);
}

function valid_location(location) {
    return (
        Array.isArray(location) &&
        location.length === 2 &&
        location.every(Number.isFinite) &&
        Math.abs(location[0]) <= 180 &&
        Math.abs(location[1]) <= 90
    );
}

function normalize_record(record, now) {
    const input = record?.spot;
    if (
        !Number.isFinite(record?.observed_at) ||
        record.observed_at > now ||
        now - record.observed_at >= MAX_AGE_MS ||
        !input ||
        !Number.isFinite(input.time) ||
        input.time <= now / 1000 - 3600 ||
        input.time > now / 1000 + 60 ||
        !Number.isFinite(input.freq) ||
        input.freq <= 0 ||
        !Number.isInteger(input.dx_dxcc_code) ||
        input.dx_dxcc_code <= 0 ||
        !Number.isInteger(input.spotter_dxcc_code) ||
        input.spotter_dxcc_code <= 0 ||
        ![input.dx_callsign, input.spotter_callsign].every(
            value =>
                typeof value === "string" &&
                value.trim().length > 0 &&
                value.length <= 32 &&
                !value.includes("|"),
        ) ||
        input.id !== `${input.time}|${input.spotter_callsign}|${input.dx_callsign}` ||
        !bands.includes(input.band) ||
        !modes.includes(input.mode) ||
        !continents.includes(input.dx_continent) ||
        !continents.includes(input.spotter_continent) ||
        !valid_location(input.dx_loc) ||
        !valid_location(input.spotter_loc)
    ) {
        return null;
    }
    const spot = {
        id: input.id,
        time: input.time,
        freq: input.freq,
        band: input.band,
        mode: input.mode,
        dx_callsign: input.dx_callsign,
        spotter_callsign: input.spotter_callsign,
        dx_dxcc_code: input.dx_dxcc_code,
        spotter_dxcc_code: input.spotter_dxcc_code,
        dx_continent: input.dx_continent,
        spotter_continent: input.spotter_continent,
        dx_loc: [...input.dx_loc],
        spotter_loc: [...input.spotter_loc],
    };
    for (const field of STRING_FIELDS) {
        if (input[field] == null) continue;
        if (typeof input[field] !== "string" || input[field].length > 4096) return null;
        spot[field] = input[field];
    }
    for (const field of NUMBER_FIELDS) {
        if (input[field] == null) continue;
        if (!Number.isFinite(input[field])) return null;
        spot[field] = input[field];
    }
    if (input.is_dxpedition != null) {
        if (typeof input.is_dxpedition !== "boolean") return null;
        spot.is_dxpedition = input.is_dxpedition;
    }
    return { spot, observed_at: record.observed_at };
}

function compact_records(records, now) {
    const by_id = new Map();
    for (const input of records) {
        const record = normalize_record(input, now);
        if (!record) continue;
        const bytes = byte_size(JSON.stringify(record));
        if (bytes > MAX_RECORD_BYTES) continue;
        const previous = by_id.get(record.spot.id);
        if (!previous || record.observed_at > previous.record.observed_at) {
            by_id.set(record.spot.id, { record, bytes });
        }
    }
    const sorted = [...by_id.values()].sort(
        (a, b) =>
            b.record.spot.time - a.record.spot.time ||
            (a.record.spot.id < b.record.spot.id
                ? -1
                : a.record.spot.id > b.record.spot.id
                  ? 1
                  : 0),
    );
    const kept = [];
    let bytes = byte_size(JSON.stringify({ version: 2, records: [] }));
    for (const entry of sorted) {
        const added_bytes = entry.bytes + (kept.length ? 2 : 0);
        if (kept.length === MAX_SPOTS || bytes + added_bytes > MAX_BYTES) break;
        bytes += added_bytes;
        kept.push(entry.record);
    }
    return kept;
}

function read_records(now) {
    try {
        const text = localStorage.getItem(KEY);
        if (!text || text.length * 2 > MAX_BYTES || byte_size(text) > MAX_BYTES) return [];
        const snapshot = JSON.parse(text);
        if (
            snapshot?.version !== 2 ||
            !Array.isArray(snapshot.records) ||
            snapshot.records.length > MAX_SPOTS
        )
            return [];
        return compact_records(snapshot.records, now);
    } catch {
        return [];
    }
}

export function read_live_spot_snapshot() {
    return read_records(Date.now()).map(record => record.spot);
}

async function persist_records(records) {
    try {
        if (!navigator.locks?.request) return false;
        return await navigator.locks.request(KEY, () => {
            const now = Date.now();
            const merged = compact_records([...read_records(now), ...records], now);
            const text = JSON.stringify({ version: 2, records: merged });
            if (localStorage.getItem(KEY) !== text) localStorage.setItem(KEY, text);
            localStorage.removeItem("live_spot_snapshot_v1");
            return true;
        });
    } catch {
        return false;
    }
}

function schedule_write() {
    if (scheduled || writing) return;
    scheduled = true;
    const flush = async () => {
        scheduled = false;
        writing = true;
        const records = pending;
        pending = [];
        drain_succeeded = (await persist_records(records)) && drain_succeeded;
        writing = false;
        if (pending.length) {
            schedule_write();
        } else {
            const resolve = resolve_drain;
            drain_promise = null;
            resolve(drain_succeeded);
        }
    };
    if (window.requestIdleCallback) {
        window.requestIdleCallback(flush, { timeout: 1000 });
    } else {
        window.setTimeout(flush, 0);
    }
}

export function write_live_spot_snapshot(spots, observed_at) {
    if (!Array.isArray(spots) || !globalThis.navigator?.locks?.request)
        return Promise.resolve(false);
    const records = compact_records(
        spots.map(spot => ({ spot, observed_at })),
        Date.now(),
    );
    if (!records.length) return Promise.resolve(false);
    pending = compact_records([...pending, ...records], Date.now());
    if (!drain_promise) {
        drain_succeeded = true;
        drain_promise = new Promise(resolve => {
            resolve_drain = resolve;
        });
    }
    const promise = drain_promise;
    schedule_write();
    return promise;
}
