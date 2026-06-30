export const TOUR_COMPLETED_CHAPTERS_KEY = "tour_completed_chapters";
export const DEFAULT_TOUR_CHAPTER_ID = "quick_start";

export const TOUR_CHAPTERS = {
    quick_start: {
        id: "quick_start",
        title: "Quick Start",
        description: "A short introduction to the main Holy Cluster workflow.",
        steps: [
            {
                target: "[data-tour='top-bar']",
                content:
                    "Welcome to The Holy Cluster! This quick tour will walk you through the main interface.",
                placement: "bottom",
                title: "Welcome",
                skipBeacon: true,
            },
        ],
    },
};

export function get_tour_chapter(chapter_id) {
    return TOUR_CHAPTERS[chapter_id] ?? null;
}
