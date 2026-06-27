import { useEffect, useMemo, useState } from "react";

const SUPPORTED_VOACAP_BANDS = new Set([
    "160",
    "80",
    "60",
    "40",
    "30",
    "20",
    "17",
    "15",
    "12",
    "10",
]);
const VOACAP_FETCH_DEBOUNCE_MS = 350;
const VOACAP_CACHE_LIMIT = 24;

const voacap_cache = new Map();

function normalize_number(value, digits) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Number(parsed.toFixed(digits));
}

function normalize_band(band) {
    const normalized = band?.toString().trim().replace(/m$/i, "");
    return SUPPORTED_VOACAP_BANDS.has(normalized) ? normalized : null;
}

function cache_set(key, value) {
    if (voacap_cache.has(key)) {
        voacap_cache.delete(key);
    }
    voacap_cache.set(key, value);
    while (voacap_cache.size > VOACAP_CACHE_LIMIT) {
        voacap_cache.delete(voacap_cache.keys().next().value);
    }
}

function build_voacap_url({ center_lat, center_lon, band, step_deg }) {
    const normalized_lat = normalize_number(center_lat, 4);
    const normalized_lon = normalize_number(center_lon, 4);
    const normalized_step = normalize_number(step_deg ?? 10, 2);
    const normalized_band = normalize_band(band);

    if (
        normalized_lat == null ||
        normalized_lon == null ||
        normalized_step == null ||
        normalized_band == null
    ) {
        return null;
    }

    const params = new URLSearchParams({
        center_lat: normalized_lat.toString(),
        center_lon: normalized_lon.toString(),
        band: normalized_band,
        step_deg: normalized_step.toString(),
        metric: "snr_db",
    });

    return `/voacap?${params.toString()}`;
}

export function useVoacap({ enabled, center_lat, center_lon, band, step_deg = 10 }) {
    const url = useMemo(
        () =>
            enabled
                ? build_voacap_url({
                      center_lat,
                      center_lon,
                      band,
                      step_deg,
                  })
                : null,
        [enabled, center_lat, center_lon, band, step_deg],
    );

    const [state, set_state] = useState({
        data: null,
        loading: false,
        error: null,
        stale: false,
        url: null,
    });

    useEffect(() => {
        if (!enabled) {
            set_state({ data: null, loading: false, error: null, stale: false, url: null });
            return;
        }

        if (!url) {
            set_state({
                data: null,
                loading: false,
                error: "Unsupported VOACAP request",
                stale: false,
                url: null,
            });
            return;
        }

        const cached = voacap_cache.get(url);
        if (cached) {
            set_state({ data: cached, loading: false, error: null, stale: false, url });
            return;
        }

        if (typeof navigator !== "undefined" && !navigator.onLine) {
            set_state(current => ({
                data: current.data,
                loading: false,
                error: "Offline",
                stale: Boolean(current.data),
                url,
            }));
            return;
        }

        const controller = new AbortController();
        set_state(current => ({
            data: current.data,
            loading: true,
            error: null,
            stale: Boolean(current.data),
            url,
        }));

        const timeout_id = window.setTimeout(() => {
            fetch(url, { signal: controller.signal })
                .then(async response => {
                    const content_type = response.headers.get("content-type") || "";
                    const text = await response.text();

                    if (!content_type.includes("application/json")) {
                        throw new Error(`VOACAP returned non-JSON (${response.status})`);
                    }

                    let body;
                    try {
                        body = JSON.parse(text);
                    } catch (_error) {
                        throw new Error(`VOACAP returned invalid JSON (${response.status})`);
                    }

                    if (response.ok) return body;

                    let detail = `VOACAP request failed (${response.status})`;
                    if (body?.detail) {
                        detail = body.detail;
                    }
                    throw new Error(detail);
                })
                .then(data => {
                    cache_set(url, data);
                    set_state({ data, loading: false, error: null, stale: false, url });
                })
                .catch(error => {
                    if (error.name === "AbortError") return;
                    set_state(current => ({
                        data: current.data,
                        loading: false,
                        error: error.message || "VOACAP request failed",
                        stale: Boolean(current.data),
                        url,
                    }));
                });
        }, VOACAP_FETCH_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timeout_id);
            controller.abort();
        };
    }, [enabled, url]);

    return state;
}

export default useVoacap;
