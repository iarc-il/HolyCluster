import { useLocalStorage } from "@uidotdev/usehooks";
import { useCallback, useMemo, useState } from "react";
import Joyride, { ACTIONS, EVENTS, STATUS } from "react-joyride";
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

            if (completed_statuses.includes(status)) {
                if (tour_state.current_chapter_id) {
                    mark_chapter_done(tour_state.current_chapter_id, status);
                }
                stop_tour();
                return;
            }

            if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
                set_tour_state(state => ({
                    ...state,
                    step_index: index + (action === ACTIONS.PREV ? -1 : 1),
                }));
            }
        },
        [mark_chapter_done, stop_tour, tour_state.current_chapter_id],
    );

    return (
        <>
            <TourLauncher completed_chapters={completed_chapters} on_start_tour={start_tour} />
            <Joyride
                callback={handle_callback}
                continuous={true}
                disableOverlayClose={true}
                run={tour_state.is_running}
                scrollToFirstStep={true}
                showProgress={true}
                showSkipButton={true}
                stepIndex={tour_state.step_index}
                steps={steps}
                styles={{
                    options: {
                        primaryColor: "#2563eb",
                        zIndex: 10000,
                    },
                }}
            />
        </>
    );
}

export default WebsiteTour;
