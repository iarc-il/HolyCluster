import { captureException } from "@sentry/react";

import { ReadyState, useWs } from "@/hooks/useWs";
import { detect_ui_build } from "@/module_load_recovery.js";
import { reportModuleRecoveryDiagnostic } from "@/sentry.js";
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from "react";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 5000;
const NAVIGATION_MARKER = "holycluster_ui_navigation";
const LAST_AUTO_TARGET = "holycluster_ui_last_auto_target";
const UiRefreshContext = createContext(null);

function is_module_load_failure(error) {
    const message = error?.message;
    if (
        typeof message === "string" &&
        /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
            message,
        )
    )
        return true;
    if (error?.name !== "SyntaxError" || message !== "Unexpected end of script") return false;
    if (typeof error.sourceURL !== "string") return false;

    try {
        const source = new URL(error.sourceURL);
        return (
            source.href === error.sourceURL &&
            source.origin === window.location.origin &&
            !source.username &&
            !source.password &&
            !source.search &&
            !source.hash &&
            /^\/assets\/[A-Za-z0-9_-]{1,128}\.js$/.test(source.pathname)
        );
    } catch {
        return false;
    }
}

function reload_page() {
    window.location.reload();
}

function report_module_recovery(diagnostic, decision, reason, reload_requested = false) {
    try {
        reportModuleRecoveryDiagnostic({
            ...diagnostic,
            decision,
            reason,
            reload_requested,
            online: navigator.onLine,
            visibility: document.visibilityState,
        });
    } catch {}
}

export function UiRefreshProvider({ children, navigate = reload_page }) {
    const running_entry = document.querySelector('meta[name="ui-entry"]')?.content;
    const ws = useWs();
    const startup_marker_ref = useRef(null);
    const outcome_sent_ref = useRef(false);
    const detected_target_ref = useRef(null);
    const [target_entry, set_target_entry] = useState(null);
    const [manual_required, set_manual_required] = useState(false);
    const [stale_recovery, set_stale_recovery] = useState(null);
    const [navigation_outcome] = useState(() => {
        try {
            const serialized = sessionStorage.getItem(NAVIGATION_MARKER);
            const marker = JSON.parse(serialized);
            startup_marker_ref.current = serialized;
            if (
                typeof marker?.source_entry !== "string" ||
                typeof marker?.target_entry !== "string"
            )
                return null;
            return {
                event: running_entry === marker.source_entry ? "target_mismatch" : "loaded_target",
                blocker: "none",
            };
        } catch {
            return null;
        }
    });
    const [blockers, set_blockers] = useState([]);
    const blocker_registrations_ref = useRef(new Map());
    const blockers_ref = useRef(blockers);
    const target_entry_ref = useRef(target_entry);
    const target_diagnostic_ref = useRef(null);
    const evaluation_timer_ref = useRef(null);
    const evaluate_ref = useRef(null);
    const stale_recovery_ref = useRef(null);
    const storage_available_ref = useRef(null);
    const last_check_ref = useRef(null);
    const last_check_failed_ref = useRef(false);
    const last_interaction_ref = useRef(Date.now());
    const check_ref = useRef(null);
    const queued_check_ref = useRef(null);
    const navigating_ref = useRef(false);
    const automatic_failure_ref = useRef(null);
    const stopped_ref = useRef(false);
    blockers_ref.current = blockers;
    target_entry_ref.current = target_entry;

    const check_for_update = useCallback(
        (fresh, on_diagnostic) => {
            if (stopped_ref.current) return Promise.resolve(null);
            if (check_ref.current) {
                if (!fresh) return check_ref.current.promise;
                if (queued_check_ref.current) {
                    const queued = queued_check_ref.current;
                    if (typeof on_diagnostic === "function") {
                        if (queued.diagnostic) {
                            try {
                                on_diagnostic(queued.diagnostic);
                            } catch {}
                        } else queued.observers.push(on_diagnostic);
                    }
                    return queued.promise;
                }
                const active = check_ref.current;
                const queued = { diagnostic: null, observers: [], promise: null };
                if (typeof on_diagnostic === "function") queued.observers.push(on_diagnostic);
                queued.promise = (async () => {
                    try {
                        await active.promise;
                        return await check_for_update(false, evidence => {
                            queued.diagnostic = evidence;
                            for (const observer of queued.observers.splice(0)) {
                                try {
                                    observer(evidence);
                                } catch {}
                            }
                        });
                    } finally {
                        queued_check_ref.current = null;
                    }
                })();
                queued_check_ref.current = queued;
                return queued.promise;
            }
            last_check_ref.current = Date.now();
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
            const check = { promise: null };
            check.promise = (async () => {
                let probe_diagnostic = null;
                try {
                    const update = await detect_ui_build({
                        entry: running_entry,
                        signal: controller.signal,
                        on_diagnostic: evidence => {
                            probe_diagnostic = evidence;
                            if (typeof on_diagnostic === "function") on_diagnostic(evidence);
                        },
                    });
                    last_check_failed_ref.current = false;
                    if (!stopped_ref.current && update) {
                        target_entry_ref.current = update.target_entry;
                        target_diagnostic_ref.current = probe_diagnostic
                            ? { target_entry: update.target_entry, evidence: probe_diagnostic }
                            : null;
                        set_target_entry(update.target_entry);
                    }
                    return update;
                } catch {
                    last_check_failed_ref.current = true;
                    return null;
                } finally {
                    window.clearTimeout(timeout);
                    if (check_ref.current === check) check_ref.current = null;
                }
            })();
            check_ref.current = check;
            return check.promise;
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

    const report = useCallback(
        (event, blocker = "none") => {
            try {
                ws?.send("ui_refresh", { event, blocker });
            } catch {}
        },
        [ws?.send],
    );

    const begin_navigation = useCallback(() => {
        navigating_ref.current = true;
        window.dispatchEvent(new Event("holycluster:ui-navigation"));
        navigate();
    }, [navigate]);

    const storage_available = useCallback(() => {
        if (storage_available_ref.current != null) return storage_available_ref.current;
        try {
            sessionStorage.setItem(`${NAVIGATION_MARKER}_probe`, "1");
            sessionStorage.removeItem(`${NAVIGATION_MARKER}_probe`);
            storage_available_ref.current = true;
        } catch {
            storage_available_ref.current = false;
        }
        return storage_available_ref.current;
    }, []);

    const manual_reload = useCallback(() => {
        if (target_entry) {
            try {
                sessionStorage.setItem(
                    NAVIGATION_MARKER,
                    JSON.stringify({ source_entry: running_entry, target_entry }),
                );
            } catch {}
        }
        report("manual_reload");
        begin_navigation();
    }, [begin_navigation, report, running_entry, target_entry]);

    const automatic_reload = useCallback(() => {
        automatic_failure_ref.current = null;
        const target = target_entry_ref.current;
        const active =
            document.visibilityState === "visible" &&
            Date.now() - last_interaction_ref.current < CHECK_INTERVAL_MS;
        if (blockers_ref.current.length > 0) {
            automatic_failure_ref.current = "blocked";
            return false;
        }
        if (active) {
            automatic_failure_ref.current = "active_page";
            return false;
        }
        if (!target) {
            automatic_failure_ref.current = "missing_target";
            return false;
        }
        if (!storage_available()) {
            automatic_failure_ref.current = "storage_unavailable";
            return false;
        }
        try {
            if (sessionStorage.getItem(LAST_AUTO_TARGET) === target) {
                automatic_failure_ref.current = "already_attempted";
                return false;
            }
            sessionStorage.setItem(LAST_AUTO_TARGET, target);
            sessionStorage.setItem(
                NAVIGATION_MARKER,
                JSON.stringify({ source_entry: running_entry, target_entry: target }),
            );
        } catch {
            storage_available_ref.current = false;
            automatic_failure_ref.current = "storage_unavailable";
            return false;
        }
        const recovery = stale_recovery_ref.current;
        if (recovery?.diagnostic && !recovery.navigation_reported) {
            const target_diagnostic = target_diagnostic_ref.current;
            const diagnostic =
                target_diagnostic?.target_entry === target
                    ? { ...recovery.diagnostic, ...target_diagnostic.evidence }
                    : recovery.target_entry === target
                      ? recovery.diagnostic
                      : null;
            if (diagnostic) {
                recovery.navigation_reported = true;
                report_module_recovery(diagnostic, "navigate", "new_build", true);
            }
        }
        report("auto_reload");
        begin_navigation();
        return true;
    }, [begin_navigation, report, running_entry, storage_available]);

    const recover_stale_module = useCallback(
        async (error, exception_event_id) => {
            const diagnostic = {
                failure:
                    error?.name === "SyntaxError" && error?.message === "Unexpected end of script"
                        ? "webkit_truncated_module"
                        : "dynamic_import",
                exception_event_id,
                page_entry: running_entry,
                probed_entry: null,
                probe_outcome: "not_started",
                probe_status: null,
                probe_content_type: null,
                probe_reason: "invalid_page_entry",
            };
            const recovery = { error, status: "checking", diagnostic };
            stale_recovery_ref.current = recovery;
            set_stale_recovery(recovery);
            const update = await check_for_update(true, evidence =>
                Object.assign(diagnostic, evidence),
            );
            if (!update) {
                report_module_recovery(diagnostic, "manual", "update_not_confirmed");
                stale_recovery_ref.current = { ...recovery, status: "manual" };
                set_stale_recovery(stale_recovery_ref.current);
                return;
            }
            recovery.target_entry = update.target_entry;
            if (blockers_ref.current.length > 0) {
                report("blocked", blockers_ref.current[0]);
                report_module_recovery(diagnostic, "blocked", "blocked");
                stale_recovery_ref.current = { ...recovery, status: "blocked" };
                set_stale_recovery(stale_recovery_ref.current);
                return;
            }
            if (
                document.visibilityState === "visible" &&
                Date.now() - last_interaction_ref.current < CHECK_INTERVAL_MS
            ) {
                report_module_recovery(diagnostic, "waiting", "active_page");
                stale_recovery_ref.current = { ...recovery, status: "waiting" };
                set_stale_recovery(stale_recovery_ref.current);
                return;
            }
            if (!automatic_reload()) {
                report_module_recovery(
                    diagnostic,
                    "manual",
                    automatic_failure_ref.current ?? "missing_target",
                );
                stale_recovery_ref.current = { ...recovery, status: "manual" };
                set_stale_recovery(stale_recovery_ref.current);
            }
        },
        [automatic_reload, check_for_update, report, running_entry],
    );

    useLayoutEffect(() => {
        function recover(event) {
            if (!is_module_load_failure(event.payload)) return;
            event.preventDefault();
            const error = event.payload;
            let exception_event_id;
            try {
                exception_event_id = captureException(error);
            } catch {}
            if (!stale_recovery_ref.current) {
                void recover_stale_module(error, exception_event_id);
            }
        }

        window.addEventListener("vite:preloadError", recover);
        return () => window.removeEventListener("vite:preloadError", recover);
    }, [recover_stale_module]);

    useEffect(() => {
        if (stale_recovery?.status !== "blocked" || blockers.length > 0) return;
        if (
            document.visibilityState === "visible" &&
            Date.now() - last_interaction_ref.current < CHECK_INTERVAL_MS
        ) {
            report_module_recovery(stale_recovery_ref.current.diagnostic, "waiting", "active_page");
            stale_recovery_ref.current = { ...stale_recovery_ref.current, status: "waiting" };
            set_stale_recovery(stale_recovery_ref.current);
        } else if (!automatic_reload()) {
            report_module_recovery(
                stale_recovery_ref.current.diagnostic,
                "manual",
                automatic_failure_ref.current ?? "missing_target",
            );
            stale_recovery_ref.current = { ...stale_recovery_ref.current, status: "manual" };
            set_stale_recovery(stale_recovery_ref.current);
        }
    }, [automatic_reload, blockers.length, stale_recovery?.status]);

    const evaluate = useCallback(() => {
        window.clearTimeout(evaluation_timer_ref.current);
        if (!target_entry_ref.current || navigating_ref.current) return;
        const blocked = blockers_ref.current.length > 0;
        const active =
            document.visibilityState === "visible" &&
            Date.now() - last_interaction_ref.current < CHECK_INTERVAL_MS;
        if (blocked || active) {
            if (blocked) report("blocked", blockers_ref.current[0]);
            evaluation_timer_ref.current = window.setTimeout(
                () => evaluate_ref.current?.(),
                CHECK_INTERVAL_MS,
            );
            return;
        }
        if (!automatic_reload()) set_manual_required(true);
    }, [automatic_reload, report]);
    evaluate_ref.current = evaluate;

    useEffect(() => {
        if (!target_entry || detected_target_ref.current === target_entry) return;
        detected_target_ref.current = target_entry;
        report("detected");
    }, [report, target_entry]);

    useEffect(() => {
        window.clearTimeout(evaluation_timer_ref.current);
        set_manual_required(false);
        if (!target_entry) return;
        if (Date.now() - last_interaction_ref.current >= CHECK_INTERVAL_MS) evaluate();
        else {
            evaluation_timer_ref.current = window.setTimeout(
                () => evaluate_ref.current?.(),
                CHECK_INTERVAL_MS,
            );
        }
        return () => window.clearTimeout(evaluation_timer_ref.current);
    }, [evaluate, target_entry]);

    useEffect(() => {
        if (!navigation_outcome || ws?.readyState !== ReadyState.OPEN || outcome_sent_ref.current)
            return;
        outcome_sent_ref.current = true;
        report(navigation_outcome.event, navigation_outcome.blocker);
        try {
            if (sessionStorage.getItem(NAVIGATION_MARKER) === startup_marker_ref.current) {
                sessionStorage.removeItem(NAVIGATION_MARKER);
            }
        } catch {}
    }, [navigation_outcome, report, ws?.readyState]);

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
                void check_and_schedule(true).then(() => evaluate_ref.current?.());
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
                manual_required,
                stale_recovery,
                navigation_outcome,
                register_blocker,
                manual_reload,
                automatic_reload,
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
