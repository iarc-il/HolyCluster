import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const UpdateContext = createContext(null);

function parse_version(value) {
    if (typeof value !== "string") return null;
    const match = value.trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/);
    if (!match) return null;
    return match.slice(1).map(part => Number.parseInt(part ?? "0", 10));
}

export function compare_update_versions(local, remote) {
    const local_version = parse_version(local);
    const remote_version = parse_version(remote);
    if (!local_version || !remote_version) return null;

    const length = Math.max(local_version.length, remote_version.length);
    for (let index = 0; index < length; index++) {
        const difference = (remote_version[index] ?? 0) - (local_version[index] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

function get_versions(version) {
    if (typeof version === "string") return { local: null, remote: version };
    if (!version || typeof version !== "object" || Array.isArray(version)) {
        return { local: null, remote: null };
    }
    return {
        local:
            version.local ?? version.local_version ?? version.current ?? version.installed ?? null,
        remote:
            version.remote ??
            version.remote_version ??
            version.latest ??
            version.available ??
            version.available_version ??
            null,
    };
}

export function normalize_update_status(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { status: "malformed", local_version: null, remote_version: null, error: null };
    }

    const { local, remote } = get_versions(payload.version ?? payload);
    const status =
        typeof payload.status === "string"
            ? payload.status
            : typeof payload.state === "string"
              ? payload.state
              : "malformed";
    const error =
        typeof payload.error === "string"
            ? payload.error
            : typeof payload.diagnostic === "string"
              ? payload.diagnostic
              : null;
    const direction = compare_update_versions(local, remote);
    const aliases = {
        unavailable: "unavailable",
        unsupported: "unsupported",
        manual: "unsupported",
        deferred: "deferred",
        loading: "loading",
        checking: "checking",
        installing: "installing",
        failed: "failed",
        error: "failed",
    };

    if (aliases[status]) {
        return {
            status: aliases[status],
            local_version: local,
            remote_version: remote,
            error,
        };
    }

    if (local != null && remote != null && direction == null) {
        return { status: "malformed", local_version: local, remote_version: remote, error };
    }
    if (direction > 0)
        return { status: "available", local_version: local, remote_version: remote, error };
    if (direction === 0)
        return { status: "current", local_version: local, remote_version: remote, error };
    if (direction < 0)
        return { status: "newer_local", local_version: local, remote_version: remote, error };

    const status_aliases = {
        available: "available",
        update_available: "available",
        current: "current",
        equal: "current",
        up_to_date: "current",
        idle: "current",
        newer_local: "newer_local",
    };
    return {
        status: status_aliases[status] ?? "malformed",
        local_version: local,
        remote_version: remote,
        error,
    };
}

async function read_update_payload(response) {
    const body = await response.text();
    if (!body.trim()) return null;
    try {
        return JSON.parse(body);
    } catch {
        throw new Error("Update response was not valid JSON");
    }
}

async function request_update(path) {
    const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
    });
    if (!response.ok) throw new Error(`Update request failed (${response.status})`);
    return normalize_update_status(await read_update_payload(response));
}

export function UpdateProvider({ children }) {
    const [update, set_update] = useState({
        status: "loading",
        local_version: null,
        remote_version: null,
        error: null,
    });

    const refresh = useCallback(async () => {
        set_update(current => ({ ...current, status: "loading", error: null }));
        try {
            const response = await fetch("/api/update");
            if (!response.ok) throw new Error(`Update status failed (${response.status})`);
            try {
                set_update(normalize_update_status(await read_update_payload(response)));
            } catch (error) {
                set_update(current => ({ ...current, status: "malformed", error: error.message }));
            }
        } catch (error) {
            set_update(current => ({ ...current, status: "unavailable", error: error.message }));
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const action = useCallback(async path => {
        set_update(current => ({
            ...current,
            status: path === "/update/install" ? "installing" : "checking",
            error: null,
        }));
        try {
            const next = await request_update(path);
            set_update(next);
            return next;
        } catch (error) {
            if (path === "/update/install") {
                set_update(current => ({ ...current, status: "installing", error: null }));
                return null;
            }
            set_update(current => ({ ...current, status: "failed", error: error.message }));
            return null;
        }
    }, []);

    const value = useMemo(
        () => ({
            ...update,
            refresh,
            check: () => action("/api/update/check"),
            install: () => action("/api/update/install"),
            defer: () => action("/api/update/defer"),
            retry: () => action("/api/update/retry"),
        }),
        [update, refresh, action],
    );

    return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useUpdate() {
    const update = useContext(UpdateContext);
    if (!update) throw new Error("useUpdate must be used within UpdateProvider");
    return update;
}
