import { useColors } from "@/hooks/useColors";
import use_radio from "@/hooks/useRadio";
import { useWs } from "@/hooks/useWs";
import { NATIVE_UPDATER_MIN_VERSION, supports_cat_feature } from "@/utils/cat_features.js";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";

const UpdateContext = createContext(null);
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

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
        reboot_required: "reboot_required",
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

async function fetch_update(path, options = {}, timeout = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(path, {
            ...options,
            signal: controller.signal,
            cache: "no-store",
        });
        const payload = await read_update_payload(response);
        if (!response.ok) {
            const error = new Error(
                payload?.diagnostic ?? `Update request failed (${response.status})`,
            );
            error.http_status = response.status;
            throw error;
        }
        return payload;
    } finally {
        clearTimeout(timer);
    }
}

async function request_update(path, dev_mode = false) {
    const payload = await fetch_update(
        path,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dev_mode }),
        },
        path.endsWith("/install") ? 600000 : 35000,
    );
    return { ...normalize_update_status(payload), session: payload?.session ?? null };
}

function terminal_session(session) {
    return (
        ["failed", "permission_cancelled", "reboot_required", "restart_failed"].includes(
            session?.phase,
        ) ||
        (session?.phase === "updated" && session.verified === true)
    );
}

function session_status(session) {
    if (session.phase === "reboot_required") return "reboot_required";
    if (["failed", "permission_cancelled", "restart_failed"].includes(session.phase))
        return "failed";
    if (session.phase === "updated") return "reconnecting";
    if (["waiting_for_parent", "awaiting_permission"].includes(session.phase)) return "installing";
    return session.phase;
}

export function UpdateProvider({ children }) {
    const { local_version } = use_radio();
    const ws = useWs();
    const { dev_mode } = useColors();
    const [allow_same_version, set_allow_same_version] = useState(false);
    const update_dev_mode = Boolean(dev_mode && allow_same_version);
    const supported = supports_cat_feature(local_version, NATIVE_UPDATER_MIN_VERSION);
    const [session, set_session_state] = useState(null);
    const session_ref = useRef(null);
    const [poll_generation, set_poll_generation] = useState(0);
    const enabled = supported || session != null;
    const enabled_ref = useRef(enabled);
    const request_generation_ref = useRef(0);
    enabled_ref.current = enabled;
    const [update, set_update] = useState({
        status: "loading",
        local_version: null,
        remote_version: null,
        error: null,
    });
    const set_session = useCallback(next => {
        session_ref.current = next;
        set_session_state(next);
    }, []);
    const adopt = useCallback(
        incoming => {
            if (!incoming?.id) return;
            const current = session_ref.current;
            if (current?.verified || (current?.id && current.id !== incoming.id)) return;
            const next = {
                ...current,
                ...incoming,
                started: current?.started ?? Date.now(),
                accepted: true,
            };
            set_session(next);
            set_update(previous => ({
                ...previous,
                status: session_status(next),
                remote_version: next.expected_version,
                error: next.diagnostic,
            }));
        },
        [set_session],
    );

    useEffect(
        () =>
            ws?.subscribe("update", message => {
                if (message.event === "restarting") adopt(message.session);
            }),
        [ws?.subscribe, adopt],
    );

    const refresh = useCallback(async () => {
        if (!supported || session_ref.current) return;
        const generation = ++request_generation_ref.current;
        set_update(current => ({ ...current, status: "loading", error: null }));
        try {
            const payload = await fetch_update("/api/update");
            if (
                !enabled_ref.current ||
                generation !== request_generation_ref.current ||
                session_ref.current
            )
                return;
            if (payload?.session && payload.session.phase !== "updated") {
                adopt(payload.session);
                return;
            }
            const next =
                payload?.state === "idle" || payload?.state === "installed"
                    ? await request_update("/api/update/check", update_dev_mode)
                    : normalize_update_status(payload);
            if (
                enabled_ref.current &&
                generation === request_generation_ref.current &&
                !session_ref.current
            )
                set_update(next);
        } catch (error) {
            if (
                !enabled_ref.current ||
                generation !== request_generation_ref.current ||
                session_ref.current
            )
                return;
            set_update(current => ({
                ...current,
                status:
                    error.message === "Update response was not valid JSON"
                        ? "malformed"
                        : "unavailable",
                error: error.message,
            }));
        }
    }, [supported, update_dev_mode, adopt]);

    useEffect(() => {
        if (session_ref.current) return;
        if (!supported) {
            request_generation_ref.current += 1;
            set_update({
                status: "loading",
                local_version: null,
                remote_version: null,
                error: null,
            });
            return;
        }
        refresh();
        const interval = window.setInterval(refresh, UPDATE_CHECK_INTERVAL_MS);
        return () => window.clearInterval(interval);
    }, [supported, refresh]);

    useEffect(() => {
        if (!session?.started || (terminal_session(session) && session.phase !== "updated")) return;
        let canceled = false;
        let timer;
        let delay = 750;
        const poll = async () => {
            if (canceled || !session_ref.current) return;
            let current = session_ref.current;
            try {
                if (current.helper_url && current.capability) {
                    const progress = await fetch_update(current.helper_url, {
                        headers: { "X-HolyCluster-Update": current.capability },
                        credentials: "omit",
                    });
                    if (!canceled && progress.id === current.id) adopt(progress);
                }
            } catch {}
            try {
                const payload = await fetch_update("/api/update");
                if (!canceled && payload?.session) adopt(payload.session);
            } catch {}
            if (canceled) return;
            current = session_ref.current;
            if (terminal_session(current) && current.phase !== "updated") return;
            if (current.id && current.installer_outcome === "installed") {
                try {
                    const ready = await fetch_update("/api/ready");
                    if (
                        !canceled &&
                        ready.update_id === current.id &&
                        ready.version === current.expected_version &&
                        ready.verified === true
                    ) {
                        set_session({ ...current, phase: "updated", verified: true });
                        set_update(previous => ({
                            ...previous,
                            status: "updated",
                            local_version: ready.version,
                            remote_version: ready.version,
                            error: null,
                        }));
                        ws?.reconnect?.();
                        return;
                    }
                } catch {}
            }
            if (!canceled) {
                timer = setTimeout(poll, delay);
                delay = Math.min(delay * 1.5, 8000);
            }
        };
        timer = setTimeout(poll, 500);
        return () => {
            canceled = true;
            clearTimeout(timer);
        };
    }, [session?.started, poll_generation, adopt, set_session, ws?.reconnect]);

    const action = useCallback(
        async path => {
            if (!supported || (session_ref.current && !terminal_session(session_ref.current)))
                return null;
            const generation = ++request_generation_ref.current;
            const is_install = path.endsWith("/install");
            if (is_install)
                set_session({
                    started: Date.now(),
                    id: null,
                    expected_version: update.remote_version,
                    phase: "requested",
                    accepted: false,
                });
            else set_session(null);
            set_update(current => ({
                ...current,
                status: is_install ? "requested" : "checking",
                error: null,
            }));
            try {
                const next = await request_update(path, update_dev_mode);
                if (!enabled_ref.current || generation !== request_generation_ref.current)
                    return next;
                if (next.session) adopt(next.session);
                else {
                    if (is_install && next.status === "installing") {
                        set_session({
                            ...session_ref.current,
                            phase: "installing",
                            accepted: true,
                        });
                    } else if (is_install) set_session(null);
                    set_update(current => ({
                        ...current,
                        ...next,
                        remote_version: next.remote_version ?? current.remote_version,
                    }));
                }
                return next;
            } catch (error) {
                if (generation !== request_generation_ref.current) return null;
                if (session_ref.current?.verified) return null;
                if (is_install && !error.http_status) {
                    if (session_ref.current?.accepted) return null;
                    set_update(current => ({
                        ...current,
                        status: "request_unconfirmed",
                        error: "The install response was lost. Waiting for confirmation; do not start another installer.",
                    }));
                } else {
                    if (is_install) set_session(null);
                    set_update(current => ({ ...current, status: "failed", error: error.message }));
                }
                return null;
            }
        },
        [supported, update_dev_mode, update.remote_version, adopt, set_session],
    );

    const value = useMemo(
        () => ({
            ...update,
            enabled,
            session,
            active: session != null && !terminal_session(session),
            allow_same_version,
            set_allow_same_version,
            refresh,
            reconnect: () => {
                ws?.reconnect?.();
                set_poll_generation(current => current + 1);
            },
            dismiss: () => {
                set_session(null);
                refresh();
            },
            check: () => action("/api/update/check"),
            install: () => action("/api/update/install"),
            defer: () => action("/api/update/defer"),
            retry: () => action("/api/update/retry"),
        }),
        [update, enabled, session, allow_same_version, refresh, action, ws?.reconnect, set_session],
    );
    return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useUpdate() {
    const update = useContext(UpdateContext);
    if (!update) throw new Error("useUpdate must be used within UpdateProvider");
    return update;
}
