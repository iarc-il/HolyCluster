import useHistoryPropagation from "@/hooks/useHistoryPropagation";
import {
    PROPAGATION_METRICS,
    select_propagation_for_time,
    to_unix_seconds,
} from "@/utils/propagation_history.js";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const RestDataContext = createContext(undefined);

export function useRestData() {
    return useContext(RestDataContext);
}

function propagation_history_covers_range(history, start_time, end_time) {
    return (
        history != null &&
        history.start_time !== null &&
        history.end_time !== null &&
        history.start_time <= start_time &&
        history.end_time >= end_time
    );
}

function is_same_propagation(left, right) {
    if (left === right) return true;
    if (!left || !right) return false;

    return PROPAGATION_METRICS.every(metric => {
        const left_metric = left[metric];
        const right_metric = right[metric];
        return (
            left_metric?.timestamp === right_metric?.timestamp &&
            left_metric?.value === right_metric?.value
        );
    });
}

export const RestDataProvider = ({
    children,
    propagation_range_start = null,
    propagation_range_end = null,
    propagation_time = null,
}) => {
    const [live_propagation, set_live_propagation] = useState();
    const [displayed_history_propagation, set_displayed_history_propagation] = useState(null);
    const [dxpeditions, set_dxpeditions] = useState([]);

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

    const { propagation_history } = useHistoryPropagation(
        is_history_propagation_mode ? propagation_range_start : null,
        is_history_propagation_mode ? propagation_range_end : null,
    );

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

    const has_propagation_history_for_range =
        is_history_propagation_mode &&
        propagation_history_covers_range(
            propagation_history,
            propagation_start_time,
            propagation_end_time,
        );
    const selected_history_propagation = useMemo(() => {
        if (!has_propagation_history_for_range) return null;
        return select_propagation_for_time(propagation_history, propagation_time);
    }, [has_propagation_history_for_range, propagation_history, propagation_time]);

    useEffect(() => {
        if (!is_history_propagation_mode) {
            set_displayed_history_propagation(null);
            return;
        }
        if (!has_propagation_history_for_range) return;

        set_displayed_history_propagation(previous =>
            is_same_propagation(previous, selected_history_propagation)
                ? previous
                : selected_history_propagation,
        );
    }, [
        is_history_propagation_mode,
        has_propagation_history_for_range,
        selected_history_propagation,
    ]);

    const propagation = is_history_propagation_mode
        ? displayed_history_propagation
        : live_propagation;

    return (
        <RestDataContext.Provider value={{ propagation, dxpeditions }}>
            {children}
        </RestDataContext.Provider>
    );
};
