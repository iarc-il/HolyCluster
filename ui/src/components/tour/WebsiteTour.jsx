import { useLocalStorage } from "@uidotdev/usehooks";
import { useCallback, useMemo, useState } from "react";
import { ACTIONS, EVENTS, Joyride, STATUS } from "react-joyride";
import TourLauncher from "./TourLauncher.jsx";
import {
    DEFAULT_TOUR_CHAPTER_ID,
    TOUR_COMPLETED_CHAPTERS_KEY,
    get_tour_chapter,
} from "./tour_chapters.jsx";

const completed_statuses = [STATUS.FINISHED, STATUS.SKIPPED];

function WebsiteTour() {
    const [completed_chapters, set_completed_chapters] = useLocalStorage(
        TOUR_COMPLETED_CHAPTERS_KEY,
        {},
    );
    const [tour_state, set_tour_state] = useState({
        current_chapter_id: null,
        is_running: false,
        step_index: 0,
    });

    const current_chapter = get_tour_chapter(tour_state.current_chapter_id);
    const steps = useMemo(() => current_chapter?.steps ?? [], [current_chapter]);

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

    const start_tour = useCallback(
        (chapter_id = DEFAULT_TOUR_CHAPTER_ID) => {
            const chapter = get_tour_chapter(chapter_id);
            if (!chapter) return;

            if (chapter.steps.length === 0) {
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
        [mark_chapter_done, stop_tour],
    );

    const handle_callback = useCallback(
        data => {
            const { action, index, status, type } = data;
            const next_step_index = index + (action === ACTIONS.PREV ? -1 : 1);

            if (completed_statuses.includes(status)) {
                if (tour_state.current_chapter_id) {
                    mark_chapter_done(tour_state.current_chapter_id, status);
                }
                stop_tour();
                return;
            }

            if (action === ACTIONS.CLOSE) {
                stop_tour();
                return;
            }

            if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
                if (next_step_index < 0 || next_step_index >= steps.length) {
                    if (tour_state.current_chapter_id) {
                        mark_chapter_done(tour_state.current_chapter_id, STATUS.FINISHED);
                    }
                    stop_tour();
                    return;
                }

                set_tour_state(state => ({
                    ...state,
                    step_index: next_step_index,
                }));
            }
        },
        [mark_chapter_done, steps.length, stop_tour, tour_state.current_chapter_id],
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
                    buttons: ["skip", "back", "close", "primary"],
                    textColor: "#f4f0f0",
                    arrowColor: "#182229",
                    overlayColor: "rgba(0, 0, 0, 0.65)",
                    overlayClickAction: null,
                    showProgress: true,
                    zIndex: 10000,
                }}
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
                }}
            />
        </>
    );
}

export default WebsiteTour;
