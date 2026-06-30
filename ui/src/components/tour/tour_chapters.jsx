export const TOUR_COMPLETED_CHAPTERS_KEY = "tour_completed_chapters";
export const DEFAULT_TOUR_CHAPTER_ID = "quick_start";

const action_buttons = ["back", "close"];

export const TOUR_CHAPTERS = {
    quick_start: {
        id: "quick_start",
        title: "Quick Start",
        description: "A short introduction to the main Holy Cluster workflow.",
        steps: [
            {
                target: "[data-tour='top-bar']",
                title: "Welcome",
                content:
                    "Welcome to The Holy Cluster. This short tour shows where the main controls live.",
                placement: "bottom",
                skipBeacon: true,
            },
            {
                target: "[data-tour='top-bar-time-limit']",
                title: "Spot Window",
                content: "Use this selector to choose how far back the live spot list should look.",
                placement: "bottom",
            },
            {
                target: "[data-tour='top-bar-submit-spot']",
                title: "Submit Spots",
                content: "This button opens the spot submission form when you want to add a spot.",
                placement: "bottom",
            },
            {
                target: "[data-tour='top-bar-settings']",
                title: "Settings",
                content:
                    "Open settings here to configure your station, display, filters, and imports.",
                placement: "bottom",
            },
            {
                target: "[data-tour='top-bar-left-menu']",
                title: "Open The Filter Rail",
                content: "Click this menu button if the band and mode filter rail is hidden.",
                mobileOnly: true,
                optional: true,
                waitFor: "[data-tour='left-column']",
                buttons: action_buttons,
                placement: "bottom",
            },
            {
                target: "[data-tour='left-column']",
                title: "Band And Mode Filters",
                content: "The left rail filters spots by band and mode with one-click toggles.",
                optional: true,
                placement: "right",
            },
            {
                target: "[data-tour='mobile-main-tabs']",
                title: "Map And Table Tabs",
                content: "On narrow screens, use these tabs to switch between the map and table.",
                mobileOnly: true,
                optional: true,
                placement: "bottom",
            },
            {
                target: "[data-tour='map-panel']",
                title: "Map",
                content:
                    "The map shows where spots are coming from and gives quick geographic context.",
                desktopOnly: true,
                optional: true,
                placement: "left",
            },
            {
                target: "[data-tour='table-panel']",
                title: "Spots Table",
                content: "The table gives a detailed sortable view of the current spots.",
                desktopOnly: true,
                optional: true,
                placement: "left",
            },
            {
                target: "[data-tour='top-bar-right-menu']",
                title: "Open The Side Panel",
                content: "Click this menu button if the side panel is hidden.",
                optional: true,
                waitFor: "[data-tour='side-panel']",
                buttons: action_buttons,
                placement: "bottom",
            },
            {
                target: "[data-tour='side-panel-tabs']",
                title: "Feature Panels",
                content:
                    "These tabs switch between advanced filters, band activity, heatmap, DXpeditions, and missing-worked tools.",
                optional: true,
                placement: "left",
            },
            {
                target: "[data-tour='tour-launcher']",
                title: "Tour Launcher",
                content: "Use this launcher to restart this tour or choose a more focused chapter.",
                placement: "top",
            },
        ],
    },
};

export function get_tour_chapter(chapter_id) {
    return TOUR_CHAPTERS[chapter_id] ?? null;
}
