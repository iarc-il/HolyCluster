export const PROPAGATION_METRICS = ["a_index", "k_index", "sfi"];

export function to_unix_seconds(value) {
    if (value instanceof Date) {
        const timestamp = value.getTime();
        return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : null;
    }

    if (value == null || value === "") {
        return null;
    }

    const numeric_value = Number(value);
    if (!Number.isFinite(numeric_value)) {
        return null;
    }

    return Math.floor(numeric_value);
}

function normalize_samples(samples) {
    if (!Array.isArray(samples)) {
        return [];
    }

    return samples
        .map(sample => ({
            timestamp: to_unix_seconds(sample?.timestamp),
            value: Number(sample?.value),
        }))
        .filter(sample => sample.timestamp !== null && Number.isFinite(sample.value))
        .sort((a, b) => a.timestamp - b.timestamp);
}

export function normalize_propagation_history(history) {
    const source_metrics = history?.metrics ?? {};
    return {
        start_time: to_unix_seconds(history?.start_time),
        end_time: to_unix_seconds(history?.end_time),
        metrics: Object.fromEntries(
            PROPAGATION_METRICS.map(metric => [metric, normalize_samples(source_metrics[metric])]),
        ),
    };
}

function find_latest_sample(samples, target_time) {
    for (let index = samples.length - 1; index >= 0; index -= 1) {
        if (samples[index].timestamp <= target_time) {
            return samples[index];
        }
    }

    return null;
}

export function select_propagation_for_time(history, time) {
    const target_time = to_unix_seconds(time);
    if (target_time === null) {
        return null;
    }

    const normalized_history = normalize_propagation_history(history);
    const selected = {};

    for (const metric of PROPAGATION_METRICS) {
        const sample = find_latest_sample(normalized_history.metrics[metric], target_time);
        if (!sample) {
            return null;
        }
        selected[metric] = sample;
    }

    return selected;
}
