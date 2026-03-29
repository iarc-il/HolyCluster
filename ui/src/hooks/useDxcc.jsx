import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useLocalStorage } from "@uidotdev/usehooks";

const DxccContext = createContext(undefined);

export const useDxcc = () => {
    const context = useContext(DxccContext);
    if (!context) throw new Error("useDxcc must be used within DxccProvider");
    return context;
};

// ── CTY.DAT PARSER ───────────────────────────────────────────────────────────
function parseCty(text) {
    const countryPrefixes = {};
    const cqZoneMap = new Map(); // country name → CQ zone number
    const ituZoneMap = new Map(); // country name → ITU zone number
    let current = null;

    for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        if (!line.startsWith(" ") && !line.startsWith("\t")) {
            const parts = line.split(":");
            if (parts.length >= 8) {
                let name = parts[0].trim();
                if (name.startsWith("*")) name = name.slice(1).trim();
                const mainPrefix = parts[7].trim().replace("*", "").toUpperCase();
                const cqZone = parseInt(parts[1].trim(), 10);
                const ituZone = parseInt(parts[2].trim(), 10);
                countryPrefixes[name] = { prefixes: [], exactCalls: [] };
                if (mainPrefix) countryPrefixes[name].prefixes.push(mainPrefix);
                if (!isNaN(cqZone)) cqZoneMap.set(name, cqZone);
                if (!isNaN(ituZone)) ituZoneMap.set(name, ituZone);
                current = name;
            }
        } else if (current) {
            const raw = line.trim().replace(/;$/, "");
            for (let item of raw.split(",")) {
                item = item.trim();
                if (!item) continue;
                const isExact = item.startsWith("=");
                const clean = item
                    .replace("=", "")
                    .replace(/\(.*?\)/g, "")
                    .replace(/\[.*?\]/g, "")
                    .trim()
                    .toUpperCase();
                if (!clean) continue;
                if (isExact) countryPrefixes[current].exactCalls.push(clean);
                else countryPrefixes[current].prefixes.push(clean);
            }
        }
    }

    const prefixMap = [];
    for (const [country, data] of Object.entries(countryPrefixes)) {
        for (const p of data.prefixes) prefixMap.push({ prefix: p, country, exact: false });
        for (const p of data.exactCalls) prefixMap.push({ prefix: p, country, exact: true });
    }
    prefixMap.sort((a, b) => b.prefix.length - a.prefix.length || a.prefix.localeCompare(b.prefix));

    return { countryPrefixes, prefixMap, cqZoneMap, ituZoneMap };
}

// ── ADIF PARSER ──────────────────────────────────────────────────────────────
function parseAdif(text) {
    const upper = text.toUpperCase();
    const callsigns = [];
    const re = /<CALL:\d+>([^<]+)/g;
    let m;
    while ((m = re.exec(upper)) !== null) callsigns.push(m[1].trim());
    const scMatch = upper.match(/<STATION_CALLSIGN:\d+>([^<]+)/);
    const stationCall = scMatch ? scMatch[1].trim() : "";
    return { callsigns, stationCall };
}

// ── CALLSIGN → COUNTRY ───────────────────────────────────────────────────────
function findWorkedCountries(prefixMap, callsigns) {
    const workedPrefixes = new Map();
    for (const call of callsigns) {
        for (const entry of prefixMap) {
            const matched = entry.exact ? call === entry.prefix : call.startsWith(entry.prefix);
            if (matched) {
                if (!workedPrefixes.has(entry.country)) workedPrefixes.set(entry.country, new Set());
                workedPrefixes.get(entry.country).add(entry.prefix);
                break;
            }
        }
    }
    return workedPrefixes;
}

// ── PROVIDER ─────────────────────────────────────────────────────────────────
export const DxccProvider = ({ children }) => {
    const [cty_data, set_cty_data] = useState(null);
    const [cty_error, set_cty_error] = useState(false);
    const [dxcc_state, set_dxcc_state] = useLocalStorage("dxcc_filter_state", null);
    // dxcc_state: { needed_list, worked_list, loaded_files, station_call, worked_prefixes } | null

    useEffect(() => {
        fetch("/cty.dat")
            .then(r => {
                if (!r.ok) throw new Error("HTTP " + r.status);
                return r.text();
            })
            .then(text => {
                const parsed = parseCty(text);
                set_cty_data(parsed);

                // Auto-detect new DXCC entities added since last ADIF load
                set_dxcc_state(prev => {
                    if (!prev?.cty_countries) return prev;
                    const prev_set = new Set(prev.cty_countries);
                    const new_countries = Object.keys(parsed.countryPrefixes).filter(
                        c => !prev_set.has(c),
                    );
                    if (new_countries.length === 0) return prev;
                    // Add new countries to needed_list (user can't have worked them yet)
                    const updated_needed = [...new Set([...prev.needed_list, ...new_countries])].sort();
                    const all_countries = Object.keys(parsed.countryPrefixes);
                    return {
                        ...prev,
                        needed_list: updated_needed,
                        cty_countries: all_countries,
                    };
                });
            })
            .catch(() => set_cty_error(true));
    }, []);

    const needed_countries = dxcc_state ? new Set(dxcc_state.needed_list) : null;

    // Look up a callsign in cty.dat and return its DXCC country name (or null)
    const lookup_cty_country = useCallback(
        callsign => {
            if (!cty_data) return null;
            for (const entry of cty_data.prefixMap) {
                const matched = entry.exact
                    ? callsign === entry.prefix
                    : callsign.startsWith(entry.prefix);
                if (matched) return entry.country;
            }
            return null;
        },
        [cty_data],
    );

    // Look up a callsign in cty.dat and return its CQ zone number (or null)
    const lookup_cq_zone = useCallback(
        callsign => {
            if (!cty_data) return null;
            for (const entry of cty_data.prefixMap) {
                const matched = entry.exact
                    ? callsign === entry.prefix
                    : callsign.startsWith(entry.prefix);
                if (matched) return cty_data.cqZoneMap.get(entry.country) ?? null;
            }
            return null;
        },
        [cty_data],
    );

    // Look up a callsign in cty.dat and return its ITU zone number (or null)
    const lookup_itu_zone = useCallback(
        callsign => {
            if (!cty_data) return null;
            for (const entry of cty_data.prefixMap) {
                const matched = entry.exact
                    ? callsign === entry.prefix
                    : callsign.startsWith(entry.prefix);
                if (matched) return cty_data.ituZoneMap.get(entry.country) ?? null;
            }
            return null;
        },
        [cty_data],
    );

    const load_adif = useCallback(
        (text, filename) => {
            if (!cty_data) return;
            const { callsigns, stationCall } = parseAdif(text);
            const new_worked = findWorkedCountries(cty_data.prefixMap, callsigns);

            // Merge with existing worked data
            const merged = new Map();
            if (dxcc_state?.worked_prefixes) {
                for (const [country, pfxArr] of Object.entries(dxcc_state.worked_prefixes)) {
                    merged.set(country, new Set(pfxArr));
                }
            }
            for (const [country, pfxSet] of new_worked) {
                if (!merged.has(country)) merged.set(country, new Set());
                for (const p of pfxSet) merged.get(country).add(p);
            }

            const all = Object.keys(cty_data.countryPrefixes);
            const worked_set = new Set(merged.keys());
            const needed_list = all.filter(c => !worked_set.has(c)).sort();
            const worked_list = all.filter(c => worked_set.has(c)).sort();

            const worked_prefixes = {};
            merged.forEach((pfxSet, country) => {
                worked_prefixes[country] = [...pfxSet].sort();
            });

            const files = dxcc_state ? [...dxcc_state.loaded_files] : [];
            if (!files.includes(filename)) files.push(filename);

            set_dxcc_state({
                needed_list,
                worked_list,
                loaded_files: files,
                station_call: stationCall || dxcc_state?.station_call || "",
                worked_prefixes,
                cty_countries: all,
            });
        },
        [cty_data, dxcc_state, set_dxcc_state],
    );

    const clear_dxcc = useCallback(() => set_dxcc_state(null), [set_dxcc_state]);

    return (
        <DxccContext.Provider
            value={{
                cty_ready: !!cty_data && !cty_error,
                cty_error,
                dxcc_state,
                needed_countries,
                lookup_cty_country,
                lookup_cq_zone,
                lookup_itu_zone,
                load_adif,
                clear_dxcc,
            }}
        >
            {children}
        </DxccContext.Provider>
    );
};
