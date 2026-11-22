import { useWs } from "@/hooks/useWs";
import { normalize_spots } from "@/utils/spot_cache_db.jsx";
import { useEffect, useState } from "react";

const DAY_MS = 86_400_000;
export const MAX_SEARCH_RANGE_MS = 14 * DAY_MS;
// Shared by the search modal and bar. Kept out of the component files so
// they export only components and stay hot-reloadable.
export const FROM_PRESETS = [
    { value: "1d", label: "1 day", summary: "Last day", ms: DAY_MS },
    { value: "2d", label: "2 days", summary: "Last 2 days", ms: 2 * DAY_MS },
    { value: "3d", label: "3 days", summary: "Last 3 days", ms: 3 * DAY_MS },
    { value: "1w", label: "1 week", summary: "Last week", ms: 7 * DAY_MS },
    { value: "2w", label: "2 weeks", summary: "Last 2 weeks", ms: 14 * DAY_MS },
];
const SEARCH_RESPONSE_TIMEOUT_MS = 30_000;
const IDLE_STATE = { raw_spots: [], fetch_state: "idle", error: null, truncated: false };

export function normalize_search_callsign(callsign) {
    return callsign.trim().toUpperCase();
}

// Opens the search modal prefilled with a callsign from anywhere in the UI,
// e.g. a spot's context menu. CallsignHistoryLauncher handles it.
export const VIEW_CALLSIGN_HISTORY_EVENT = "view-callsign-history";

export function view_callsign_history(callsign) {
    document.dispatchEvent(new CustomEvent(VIEW_CALLSIGN_HISTORY_EVENT, { detail: { callsign } }));
}

// Responses aren't tagged with a request id, so the echoed query is what ties
// a response to its request.
function request_search(send, subscribe, wait_for_open, query, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let timer;
        const finish = (error, response) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            unsubscribe();
            signal.removeEventListener("abort", on_abort);
            if (error) reject(error);
            else resolve(response);
        };
        const on_abort = () => finish(new DOMException("Aborted", "AbortError"));
        const unsubscribe = subscribe("search", data => {
            if (
                data.dx_callsign !== query.dx_callsign ||
                data.start_time !== query.start_time ||
                data.end_time !== query.end_time
            ) {
                return;
            }
            finish(null, data);
        });
        signal.addEventListener("abort", on_abort);

        wait_for_open(signal)
            .then(() => {
                if (settled) return;
                timer = setTimeout(
                    () => finish(new Error("Search timed out")),
                    SEARCH_RESPONSE_TIMEOUT_MS,
                );
                if (send("search", query) === false) {
                    finish(new Error("Connection is not open"));
                }
            })
            .catch(finish);
    });
}

// `search` is { callsign, start: Date, end: Date, ... } or null; extra fields
// (the modal's presets) are ignored here. A new object
// re-runs the search even if its values are unchanged.
export default function useCallsignSearch(search) {
    const { send, subscribe, wait_for_open } = useWs();
    const [state, set_state] = useState(IDLE_STATE);

    useEffect(() => {
        if (!search) {
            set_state(IDLE_STATE);
            return;
        }

        const controller = new AbortController();
        set_state({ ...IDLE_STATE, fetch_state: "loading" });
        const query = {
            dx_callsign: normalize_search_callsign(search.callsign),
            start_time: Math.floor(search.start.getTime() / 1000),
            end_time: Math.floor(search.end.getTime() / 1000),
        };

        request_search(send, subscribe, wait_for_open, query, controller.signal)
            .then(response =>
                set_state({
                    raw_spots: normalize_spots(response.spots),
                    fetch_state: "done",
                    error: null,
                    truncated: !!response.truncated,
                }),
            )
            .catch(error => {
                if (error.name === "AbortError") return;
                set_state({ ...IDLE_STATE, fetch_state: "error", error: error.message });
            });

        return () => controller.abort();
    }, [search, send, subscribe, wait_for_open]);

    return state;
}
