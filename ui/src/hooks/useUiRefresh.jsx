import { detect_ui_build } from "@/module_load_recovery.js";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 5000;
const UiRefreshContext = createContext(null);

export function UiRefreshProvider({ children }) {
    const running_entry = document.querySelector('meta[name="ui-entry"]')?.content;
    const [target_entry, set_target_entry] = useState(null);
    const [blockers, set_blockers] = useState([]);
    const blocker_registrations_ref = useRef(new Map());
    const last_check_ref = useRef(null);
    const last_check_failed_ref = useRef(false);
    const last_interaction_ref = useRef(Date.now());
    const check_ref = useRef(null);
    const queued_check_ref = useRef(null);
    const navigating_ref = useRef(false);
    const stopped_ref = useRef(false);

    const check_for_update = useCallback(
        (fresh = false) => {
            if (stopped_ref.current) return Promise.resolve(null);
            if (check_ref.current) {
                if (!fresh) return check_ref.current;
                if (!queued_check_ref.current) {
                    queued_check_ref.current = (async () => {
                        try {
                            await check_ref.current;
                            return await check_for_update();
                        } finally {
                            queued_check_ref.current = null;
                        }
                    })();
                }
                return queued_check_ref.current;
            }
            last_check_ref.current = Date.now();
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
            const check = (async () => {
                try {
                    const update = await detect_ui_build({
                        entry: running_entry,
                        signal: controller.signal,
                    });
                    last_check_failed_ref.current = false;
                    if (!stopped_ref.current && update) set_target_entry(update.target_entry);
                    return update;
                } catch {
                    last_check_failed_ref.current = true;
                    return null;
                } finally {
                    window.clearTimeout(timeout);
                    check_ref.current = null;
                }
            })();
            check_ref.current = check;
            return check;
        },
        [running_entry],
    );

    const register_blocker = useCallback((token, reason) => {
        const registration = { reason };
        blocker_registrations_ref.current.set(token, registration);
        set_blockers([...blocker_registrations_ref.current.values()].map(value => value.reason));
        return () => {
            if (blocker_registrations_ref.current.get(token) !== registration) return;
            blocker_registrations_ref.current.delete(token);
            set_blockers(
                [...blocker_registrations_ref.current.values()].map(value => value.reason),
            );
        };
    }, []);

    const reload = useCallback(() => {
        navigating_ref.current = true;
        window.location.reload();
    }, []);

    useEffect(() => {
        stopped_ref.current = false;
        let active = true;
        let timer;

        function schedule() {
            if (!active) return;
            window.clearTimeout(timer);
            const last_check = last_check_ref.current;
            const delay =
                last_check == null ? 0 : Math.max(0, last_check + CHECK_INTERVAL_MS - Date.now());
            timer = window.setTimeout(() => {
                void check_and_schedule();
            }, delay);
        }

        async function check_and_schedule(fresh = false) {
            await check_for_update(fresh);
            schedule();
        }

        function interaction(event) {
            if (event.isTrusted) last_interaction_ref.current = Date.now();
        }

        function visibility_changed() {
            if (navigating_ref.current) return;
            if (document.visibilityState === "hidden") {
                void check_and_schedule(true);
                return;
            }
            last_interaction_ref.current = Date.now();
            if (
                last_check_ref.current == null ||
                Date.now() - last_check_ref.current >= CHECK_INTERVAL_MS
            ) {
                void check_and_schedule();
            }
        }

        function online() {
            if (last_check_failed_ref.current) void check_and_schedule();
        }

        function navigating() {
            navigating_ref.current = true;
        }

        for (const type of ["pointerdown", "keydown", "touchstart", "wheel"]) {
            window.addEventListener(type, interaction, { passive: true });
        }
        document.addEventListener("visibilitychange", visibility_changed);
        window.addEventListener("online", online);
        window.addEventListener("holycluster:ui-navigation", navigating);
        if (last_check_ref.current == null) void check_and_schedule();
        else schedule();

        return () => {
            active = false;
            stopped_ref.current = true;
            window.clearTimeout(timer);
            for (const type of ["pointerdown", "keydown", "touchstart", "wheel"]) {
                window.removeEventListener(type, interaction);
            }
            document.removeEventListener("visibilitychange", visibility_changed);
            window.removeEventListener("online", online);
            window.removeEventListener("holycluster:ui-navigation", navigating);
        };
    }, [check_for_update]);

    return (
        <UiRefreshContext.Provider
            value={{
                current_entry: running_entry,
                target_entry,
                blockers,
                register_blocker,
                reload,
            }}
        >
            {children}
        </UiRefreshContext.Provider>
    );
}

export function useUiRefresh() {
    const refresh = useContext(UiRefreshContext);
    if (!refresh) throw new Error("useUiRefresh must be used within UiRefreshProvider");
    return refresh;
}

export function useUiRefreshBlocker(active, reason) {
    const register_blocker = useContext(UiRefreshContext)?.register_blocker;
    const token_ref = useRef(null);
    if (token_ref.current == null) token_ref.current = Symbol(reason);

    useEffect(() => {
        if (!active || !register_blocker) return;
        return register_blocker(token_ref.current, reason);
    }, [active, reason, register_blocker]);
}

export function useUiRefreshGraceBlocker(reason, duration) {
    const [active, set_active] = useState(false);
    const operation_ref = useRef(null);
    const timer_ref = useRef(null);
    useUiRefreshBlocker(active, reason);

    const clear = useCallback(() => {
        window.clearTimeout(timer_ref.current);
        timer_ref.current = null;
        operation_ref.current = null;
        set_active(false);
    }, []);

    const start = useCallback(
        operation => {
            window.clearTimeout(timer_ref.current);
            operation_ref.current = operation;
            set_active(true);
            timer_ref.current = window.setTimeout(clear, duration);
        },
        [clear, duration],
    );

    const finish = useCallback(
        operation => {
            if (operation_ref.current !== operation) return false;
            clear();
            return true;
        },
        [clear],
    );

    useEffect(
        () => () => {
            window.clearTimeout(timer_ref.current);
            operation_ref.current = null;
        },
        [],
    );

    return { active, start, finish };
}
