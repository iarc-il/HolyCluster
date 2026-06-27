import {
    normalize_propagation_history,
    select_propagation_for_time,
    to_unix_seconds,
} from "@/utils/propagation_history.js";
import { createContext, useContext, useEffect, useRef, useState } from "react";

const RestDataContext = createContext(undefined);

export function useRestData() {
    return useContext(RestDataContext);
}

function find_cached_propagation_history(cache, start_time, end_time) {
    return (
        cache.find(entry => entry.start_time <= start_time && entry.end_time >= end_time) ?? null
    );
}

export const RestDataProvider = ({
    children,
    propagation_range_start = null,
    propagation_range_end = null,
    propagation_time = null,
}) => {
    const [live_propagation, set_live_propagation] = useState();
    const [propagation_history, set_propagation_history] = useState(null);
    const [dxpeditions, set_dxpeditions] = useState([]);
    const propagation_history_cache_ref = useRef([]);

    const propagation_start_time = to_unix_seconds(propagation_range_start);
    const propagation_end_time = to_unix_seconds(propagation_range_end);
    const is_history_propagation_mode =
        propagation_start_time !== null &&
        propagation_end_time !== null &&
        propagation_time !== null &&
        propagation_end_time > propagation_start_time;

    useEffect(() => {
        if (is_history_propagation_mode) return;

        const fetch_propagation = () => {
            if (!navigator.onLine) return;

            fetch("/propagation")
                .then(response => (response.ok ? response.json() : Promise.reject(response)))
                .then(data => data && set_live_propagation(data))
                .catch(() => {});
        };

        fetch_propagation();
        const interval_id = setInterval(fetch_propagation, 3600 * 1000);
        return () => clearInterval(interval_id);
    }, [is_history_propagation_mode]);

    useEffect(() => {
        if (!is_history_propagation_mode) {
            set_propagation_history(null);
            return;
        }

        const cached_history = find_cached_propagation_history(
            propagation_history_cache_ref.current,
            propagation_start_time,
            propagation_end_time,
        );
        if (cached_history) {
            set_propagation_history(cached_history);
            return;
        }

        set_propagation_history(null);
        if (!navigator.onLine) return;

        const controller = new AbortController();
        const params = new URLSearchParams({
            start_time: String(propagation_start_time),
            end_time: String(propagation_end_time),
        });

        fetch(`/propagation/history?${params}`, { signal: controller.signal })
            .then(response => (response.ok ? response.json() : Promise.reject(response)))
            .then(data => {
                const history = normalize_propagation_history(data);
                if (history.start_time === null || history.end_time === null) return;

                propagation_history_cache_ref.current = [
                    ...propagation_history_cache_ref.current,
                    history,
                ];
                set_propagation_history(history);
            })
            .catch(error => {
                if (error.name === "AbortError") return;
            });

        return () => controller.abort();
    }, [is_history_propagation_mode, propagation_start_time, propagation_end_time]);

    useEffect(() => {
        const fetch_dxpeditions = () => {
            if (!navigator.onLine) return;

            fetch("/dxpeditions")
                .then(response => (response.ok ? response.json() : Promise.reject(response)))
                .then(
                    data => data && set_dxpeditions(data.map((item, id) => ({ id: id, ...item }))),
                )
                .catch(() => {});
        };

        fetch_dxpeditions();
        const interval_id = setInterval(fetch_dxpeditions, 3600 * 1000);
        return () => clearInterval(interval_id);
    }, []);

    const propagation = is_history_propagation_mode
        ? select_propagation_for_time(propagation_history, propagation_time)
        : live_propagation;

    return (
        <RestDataContext.Provider value={{ propagation, dxpeditions }}>
            {children}
        </RestDataContext.Provider>
    );
};
