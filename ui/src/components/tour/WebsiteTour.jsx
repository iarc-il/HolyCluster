import { useFilters } from "@/hooks/useFilters";
import use_radio from "@/hooks/useRadio";
import { useRestData } from "@/hooks/useRestData";
import { useSpotData } from "@/hooks/useSpotData";
import { useLocalStorage, useMediaQuery } from "@uidotdev/usehooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ACTIONS, EVENTS, Joyride, STATUS } from "react-joyride";
import TourLauncher from "./TourLauncher.jsx";
import {
    DEFAULT_TOUR_CHAPTER_ID,
    TOUR_COMPLETED_CHAPTERS_KEY,
    get_tour_chapter,
} from "./tour_chapters.jsx";
import {
    TOUR_CLOSE_MAP_CONTROLS_EVENT,
    TOUR_CLOSE_MODAL_EVENT,
    TOUR_FILTER_OPTIONS_EVENT,
} from "./tour_events.js";

const completed_statuses = new Set([STATUS.FINISHED, STATUS.SKIPPED]);
const wait_poll_interval_ms = 150;

function as_array(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
}

function is_element_visible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;

    return element.getClientRects().length > 0;
}

function is_selector_visible(selector) {
    if (typeof document === "undefined") return false;

    const element = document.querySelector(selector);
    return is_element_visible(element);
}

function are_selectors_visible(selectors) {
    const selector_list = as_array(selectors);
    return selector_list.length > 0 && selector_list.every(is_selector_visible);
}

function are_selectors_gone(selectors) {
    const selector_list = as_array(selectors);
    return (
        selector_list.length > 0 && selector_list.every(selector => !is_selector_visible(selector))
    );
}

function requirements_are_met(requirements, runtime_conditions) {
    return as_array(requirements).every(requirement => runtime_conditions[requirement] === true);
}

function step_wait_is_satisfied(step) {
    if (step.waitFor && are_selectors_visible(step.waitFor)) return true;
    if (step.waitForGone && are_selectors_gone(step.waitForGone)) return true;
    return false;
}

function get_wait_for_change_value(wait_for_change) {
    const target = document.querySelector(wait_for_change.selector);
    if (!is_element_visible(target)) return null;

    if (wait_for_change.attribute) return target.getAttribute(wait_for_change.attribute);
    return target.textContent;
}

function cleanup_chapter(chapter_id) {
    if (typeof document === "undefined") return;

    if (chapter_id === "map") {
        document.dispatchEvent(new Event(TOUR_CLOSE_MAP_CONTROLS_EVENT));
    }

    if (["filters", "settings", "submit_spot"].includes(chapter_id)) {
        document.dispatchEvent(new Event(TOUR_CLOSE_MODAL_EVENT));
    }
}

function WebsiteTour() {
    const { propagation } = useRestData();
    const { filters } = useFilters();
    const { radio_status } = use_radio();
    const { spots, set_spot_buffering } = useSpotData();
    const is_mobile = useMediaQuery("only screen and (max-width : 768px)");
    const [completed_chapters, set_completed_chapters] = useLocalStorage(
        TOUR_COMPLETED_CHAPTERS_KEY,
        {},
    );
    const [tour_state, set_tour_state] = useState({
        current_chapter_id: null,
        is_running: false,
        step_index: 0,
    });
    const wait_for_change_ref = useRef({ key: null, value: null });

    const current_chapter = get_tour_chapter(tour_state.current_chapter_id);
    const chapter_steps = useMemo(() => current_chapter?.steps ?? [], [current_chapter]);
    const runtime_conditions = useMemo(
        () => ({
            has_spots: spots.length > 0,
            manual_band_filter_available: !filters.radio_band,
            propagation_loaded: Boolean(propagation),
            radio_available: radio_status !== "unavailable",
        }),
        [filters.radio_band, propagation, radio_status, spots.length],
    );

    const mark_chapter_done = useCallback(
        (chapter_id, status) => {
            set_completed_chapters(chapters => ({
                ...chapters,
                [chapter_id]: {
                    status,
                    completed_at: new Date().toISOString(),
                },
            }));
        },
        [set_completed_chapters],
    );

    const stop_tour = useCallback(() => {
        set_tour_state({ current_chapter_id: null, is_running: false, step_index: 0 });
    }, []);

    const finish_tour = useCallback(
        status => {
            if (tour_state.current_chapter_id && status) {
                mark_chapter_done(tour_state.current_chapter_id, status);
            }

            cleanup_chapter(tour_state.current_chapter_id);
            stop_tour();
        },
        [mark_chapter_done, stop_tour, tour_state.current_chapter_id],
    );

    const should_skip_step = useCallback(
        step => {
            if (!step) return true;
            if (step.desktopOnly && is_mobile) return true;
            if (step.mobileOnly && !is_mobile) return true;
            if (step.requires && !requirements_are_met(step.requires, runtime_conditions))
                return true;
            if (step.optional && step.target && !is_selector_visible(step.target)) return true;

            return false;
        },
        [is_mobile, runtime_conditions],
    );

    const get_available_steps = useCallback(
        step_list => step_list.filter(step => !should_skip_step(step)),
        [should_skip_step],
    );

    const steps = useMemo(
        () => get_available_steps(chapter_steps),
        [chapter_steps, get_available_steps],
    );
    const current_step = steps[tour_state.step_index];

    const find_available_step_index = useCallback(
        (step_list, start_index, direction) => {
            for (
                let index = start_index;
                index >= 0 && index < step_list.length;
                index += direction
            ) {
                if (!should_skip_step(step_list[index])) return index;
            }

            return null;
        },
        [should_skip_step],
    );

    const advance_tour = useCallback(
        (from_index, direction = 1) => {
            const next_step_index = find_available_step_index(
                steps,
                from_index + direction,
                direction,
            );

            if (next_step_index == null) {
                if (direction > 0) {
                    finish_tour(STATUS.FINISHED);
                }
                return;
            }

            set_tour_state(state => {
                if (!state.is_running) return state;

                return {
                    ...state,
                    step_index: next_step_index,
                };
            });
        },
        [find_available_step_index, finish_tour, steps],
    );

    const start_tour = useCallback(
        (chapter_id = DEFAULT_TOUR_CHAPTER_ID) => {
            const chapter = get_tour_chapter(chapter_id);
            if (!chapter) return;

            if (chapter.steps.length === 0) {
                mark_chapter_done(chapter.id, STATUS.FINISHED);
                stop_tour();
                return;
            }

            const available_steps = get_available_steps(chapter.steps);
            if (available_steps.length === 0) {
                mark_chapter_done(chapter.id, STATUS.FINISHED);
                stop_tour();
                return;
            }

            set_tour_state({
                current_chapter_id: chapter.id,
                is_running: true,
                step_index: 0,
            });
        },
        [get_available_steps, mark_chapter_done, stop_tour],
    );

    useEffect(() => {
        if (!tour_state.is_running) return;
        if (current_step && !should_skip_step(current_step)) return;

        const next_step_index = find_available_step_index(steps, tour_state.step_index + 1, 1);
        if (next_step_index == null) {
            finish_tour(STATUS.FINISHED);
            return;
        }

        set_tour_state(state => ({ ...state, step_index: next_step_index }));
    }, [
        current_step,
        find_available_step_index,
        finish_tour,
        should_skip_step,
        steps,
        tour_state.is_running,
        tour_state.step_index,
    ]);

    useEffect(() => {
        if (!tour_state.is_running || !current_step?.forceFilterOptions) return;

        document.dispatchEvent(
            new CustomEvent(TOUR_FILTER_OPTIONS_EVENT, {
                detail: { ...current_step.forceFilterOptions, open: true },
            }),
        );

        return () => {
            document.dispatchEvent(
                new CustomEvent(TOUR_FILTER_OPTIONS_EVENT, {
                    detail: { ...current_step.forceFilterOptions, open: false },
                }),
            );
        };
    }, [current_step, tour_state.is_running]);

    useEffect(() => {
        if (!tour_state.is_running) {
            wait_for_change_ref.current = { key: null, value: null };
            return;
        }

        if (!current_step?.waitForChange) {
            wait_for_change_ref.current = { key: null, value: null };
        }

        if (!current_step?.waitFor && !current_step?.waitForGone && !current_step?.waitForChange) {
            return;
        }

        let has_advanced = false;
        const wait_for_change_key = current_step.waitForChange
            ? `${tour_state.current_chapter_id}:${tour_state.step_index}:${current_step.waitForChange.selector}:${current_step.waitForChange.attribute ?? "text"}`
            : null;

        if (current_step.waitForChange && wait_for_change_ref.current.key !== wait_for_change_key) {
            wait_for_change_ref.current = {
                key: wait_for_change_key,
                value: get_wait_for_change_value(current_step.waitForChange),
            };
        }

        const try_advance = () => {
            if (has_advanced) return;

            if (current_step.waitForChange) {
                const current_change_value = get_wait_for_change_value(current_step.waitForChange);
                if (current_change_value == null) return;

                if (wait_for_change_ref.current.value == null) {
                    wait_for_change_ref.current = {
                        key: wait_for_change_key,
                        value: current_change_value,
                    };
                    return;
                }

                if (current_change_value === wait_for_change_ref.current.value) return;
            } else if (!step_wait_is_satisfied(current_step)) {
                return;
            }

            has_advanced = true;
            advance_tour(tour_state.step_index, 1);
        };

        try_advance();
        if (has_advanced) return;

        const observer = new MutationObserver(try_advance);
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: [
                "aria-hidden",
                "aria-pressed",
                "class",
                "data-tour-state",
                "hidden",
                "style",
            ],
            childList: true,
            subtree: true,
        });
        const poll_timer = setInterval(try_advance, wait_poll_interval_ms);

        return () => {
            observer.disconnect();
            clearInterval(poll_timer);
        };
    }, [
        advance_tour,
        current_step,
        tour_state.current_chapter_id,
        tour_state.is_running,
        tour_state.step_index,
    ]);

    useEffect(() => {
        if (!tour_state.is_running) return;

        set_spot_buffering(true);
        return () => set_spot_buffering(false);
    }, [set_spot_buffering, tour_state.is_running]);

    const handle_callback = useCallback(
        data => {
            const { action, index, status, type } = data;

            if (completed_statuses.has(status)) {
                finish_tour(status);
                return;
            }

            if (action === ACTIONS.CLOSE) {
                cleanup_chapter(tour_state.current_chapter_id);
                stop_tour();
                return;
            }

            if (type === EVENTS.TARGET_NOT_FOUND) {
                if (steps[index]?.optional) {
                    advance_tour(index, 1);
                }
                return;
            }

            if (type === EVENTS.STEP_AFTER) {
                const direction = action === ACTIONS.PREV ? -1 : 1;
                advance_tour(index, direction);
            }
        },
        [advance_tour, finish_tour, steps, stop_tour],
    );

    return (
        <>
            <TourLauncher completed_chapters={completed_chapters} on_start_tour={start_tour} />
            <Joyride
                continuous={true}
                onEvent={handle_callback}
                options={{
                    primaryColor: "#3b82f6",
                    backgroundColor: "#182229",
                    blockTargetInteraction: false,
                    buttons: ["skip", "back", "close", "primary"],
                    textColor: "#f4f0f0",
                    arrowColor: "#182229",
                    overlayColor: "rgba(0, 0, 0, 0.65)",
                    overlayClickAction: null,
                    showProgress: true,
                    spotlightRadius: 8,
                    zIndex: 10000,
                }}
                locale={{ last: "Done" }}
                run={tour_state.is_running}
                scrollToFirstStep={true}
                stepIndex={tour_state.step_index}
                steps={steps}
                styles={{
                    tooltip: {
                        border: "1px solid #334155",
                        borderRadius: 12,
                        boxShadow: "0 18px 60px rgba(0, 0, 0, 0.45)",
                        padding: 16,
                    },
                    tooltipTitle: {
                        fontSize: 18,
                        fontWeight: 700,
                    },
                    tooltipContent: {
                        fontSize: 14,
                        lineHeight: "1.5",
                    },
                    buttonPrimary: {
                        backgroundColor: "#3b82f6",
                        borderRadius: 8,
                        color: "#ffffff",
                        fontSize: 14,
                        fontWeight: 600,
                        padding: "8px 16px",
                    },
                    buttonBack: {
                        color: "#f4f0f0",
                        fontSize: 14,
                        fontWeight: 500,
                    },
                    buttonSkip: {
                        color: "#9ca3af",
                        fontSize: 13,
                        fontWeight: 500,
                    },
                    buttonClose: {
                        color: "#9ca3af",
                        height: 24,
                        width: 24,
                    },
                    overlay: {
                        height: "100%",
                        width: "100%",
                    },
                    spotlight: {
                        stroke: "#60a5fa",
                        strokeWidth: 2,
                    },
                }}
            />
        </>
    );
}

export default WebsiteTour;
