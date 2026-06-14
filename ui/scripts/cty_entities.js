import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const CTY_URL = "https://www.country-files.com/cty/cty.csv";
export const CTY_CACHE_DIR = path.join(os.homedir(), ".cache", "holycluster", "country-files");
export const CTY_CACHE_PATH = path.join(CTY_CACHE_DIR, "cty.csv");
export const CTY_METADATA_PATH = path.join(CTY_CACHE_DIR, "cty_metadata.json");
export const CTY_REFRESH_TIMEOUT_MS = 30_000;

const CTY_DXCC_FIELD_INDEX = 2;
const CTY_CONTINENT_FIELD_INDEX = 3;
const CTY_ALIAS_FIELD_INDEX = 9;

export class CtyCacheError extends Error {
    constructor(message, cause = null) {
        super(message);
        this.name = "CtyCacheError";
        this.cause = cause;
    }
}

function get_cache_paths(cache_dir = CTY_CACHE_DIR) {
    return {
        cache_dir,
        cache_path: path.join(cache_dir, "cty.csv"),
        metadata_path: path.join(cache_dir, "cty_metadata.json"),
    };
}

async function path_exists(file_path) {
    try {
        await fs.access(file_path);
        return true;
    } catch {
        return false;
    }
}

async function read_metadata(metadata_path) {
    try {
        return JSON.parse(await fs.readFile(metadata_path, "utf8"));
    } catch (error) {
        if (error?.code === "ENOENT" || error instanceof SyntaxError) {
            return {};
        }
        throw error;
    }
}

async function conditional_headers(cache_path, metadata_path) {
    if (!(await path_exists(cache_path))) return {};

    const metadata = await read_metadata(metadata_path);
    const headers = {};
    if (metadata.etag) headers["If-None-Match"] = metadata.etag;
    if (metadata.last_modified) headers["If-Modified-Since"] = metadata.last_modified;
    return headers;
}

function get_response_header(response, header_name) {
    if (typeof response.headers?.get === "function") {
        return response.headers.get(header_name);
    }
    return response.headers?.[header_name] ?? response.headers?.[header_name.toLowerCase()] ?? null;
}

async function write_metadata(metadata_path, response, url, content_length) {
    const metadata = {
        url,
        etag: get_response_header(response, "etag"),
        last_modified: get_response_header(response, "last-modified"),
        content_length,
        downloaded_at: Date.now() / 1000,
    };
    await fs.mkdir(path.dirname(metadata_path), { recursive: true });
    await fs.writeFile(metadata_path, `${JSON.stringify(metadata, null, 2)}\n`);
}

async function fetch_with_timeout(url, headers, timeout_ms, fetch_impl) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeout_ms);
    try {
        return await fetch_impl(url, { headers, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

export async function refreshCtyCache({
    cache_dir = CTY_CACHE_DIR,
    fetch_impl = globalThis.fetch,
    timeout_ms = CTY_REFRESH_TIMEOUT_MS,
    url = CTY_URL,
} = {}) {
    if (typeof fetch_impl !== "function") {
        throw new CtyCacheError("CTY cache refresh requires a fetch implementation");
    }

    const { cache_path, metadata_path } = get_cache_paths(cache_dir);
    const headers = await conditional_headers(cache_path, metadata_path);

    try {
        const response = await fetch_with_timeout(url, headers, timeout_ms, fetch_impl);
        if (response.status === 304 && (await path_exists(cache_path))) {
            return {
                path: cache_path,
                available: true,
                downloaded: false,
                message: "cache is current",
            };
        }

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();
        if (!text.trim()) {
            throw new Error("downloaded CTY file is empty");
        }

        await fs.mkdir(path.dirname(cache_path), { recursive: true });
        const tmp_path = `${cache_path}.tmp`;
        await fs.writeFile(tmp_path, text);
        await fs.rename(tmp_path, cache_path);
        await write_metadata(metadata_path, response, url, Buffer.byteLength(text));

        return {
            path: cache_path,
            available: true,
            downloaded: true,
            message: "downloaded",
        };
    } catch (error) {
        if (await path_exists(cache_path)) {
            return {
                path: cache_path,
                available: true,
                downloaded: false,
                message: `using cached file after refresh failure: ${error.message}`,
            };
        }

        throw new CtyCacheError(
            `no CTY file available after refresh failure from ${url}: ${error.message}`,
            error,
        );
    }
}

async function get_existing_cty_cache(cache_dir) {
    const { cache_path } = get_cache_paths(cache_dir);
    if (!(await path_exists(cache_path))) {
        throw new CtyCacheError(`CTY cache is unavailable: ${cache_path}`);
    }

    return {
        path: cache_path,
        available: true,
        downloaded: false,
        message: "using cached file",
    };
}

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
    const rows = parse_cty_rows(csv_text);
    const canonical_countries_by_dxcc = build_canonical_countries_by_dxcc(rows);

    return Object.fromEntries(
        Array.from(canonical_countries_by_dxcc.entries())
            .filter(([dxcc_code]) => is_valid_dxcc_code(dxcc_code))
            .sort(([code_a], [code_b]) => Number(code_a) - Number(code_b)),
    );
}

export async function loadCtyDxccData({ refresh = true, cache_dir = CTY_CACHE_DIR } = {}) {
    const cache_result = refresh
        ? await refreshCtyCache({ cache_dir })
        : await get_existing_cty_cache(cache_dir);
    const csv_text = await fs.readFile(cache_result.path, "utf8");

    return {
        cache_result,
        country_names: parseCtyCountryNames(csv_text),
        dxcc_code_entities: parseCtyDxccCodeEntities(csv_text),
    };
}

export async function loadCtyCountryNames({ refresh = true, cache_dir = CTY_CACHE_DIR } = {}) {
    const { cache_result, country_names } = await loadCtyDxccData({ refresh, cache_dir });
    return { cache_result, country_names };
}

export const VIRTUAL_CTY_DXCC_ENTITIES_MODULE_ID = "virtual:cty-dxcc-entities";

export function ctyDxccEntitiesPlugin({ refresh = true, cache_dir = CTY_CACHE_DIR } = {}) {
    const resolved_virtual_module_id = `\0${VIRTUAL_CTY_DXCC_ENTITIES_MODULE_ID}`;

    return {
        name: "cty-dxcc-entities",
        resolveId(id) {
            if (id === VIRTUAL_CTY_DXCC_ENTITIES_MODULE_ID) return resolved_virtual_module_id;
            return null;
        },
        async load(id) {
            if (id !== resolved_virtual_module_id) return null;

            const { cache_result, country_names, dxcc_code_entities } = await loadCtyDxccData({
                refresh,
                cache_dir,
            });
            const action = cache_result.downloaded ? "Downloaded" : "Loaded cached";
            this.info(
                `${action} CTY country file for DXCC entity labels: ${cache_result.path} (${cache_result.message})`,
            );

            // The browser bundle receives only derived CTY data, never cty.csv.
            return [
                `export const dxcc_code_entities = ${JSON.stringify(dxcc_code_entities)};`,
                `export default ${JSON.stringify(country_names)};`,
                "",
            ].join("\n");
        },
    };
}
