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
    map: {
        id: "map",
        title: "Map",
        description: "Learn the map controls, overlays, and propagation indicators.",
        steps: [
            {
                target: "[data-tour='mobile-main-tabs']",
                title: "Show The Map",
                content: "Tap the Map tab if the map is not currently visible.",
                mobileOnly: true,
                optional: true,
                waitFor: "[data-tour='map-controls']",
                buttons: action_buttons,
                placement: "bottom",
                skipBeacon: true,
            },
            {
                target: "[data-tour='map-panel']",
                title: "Map View",
                content:
                    "The map shows active spots geographically and helps you spot regional openings.",
                desktopOnly: true,
                optional: true,
                placement: "left",
                skipBeacon: true,
            },
            {
                target: "[data-tour='map-controls']",
                title: "Map Controls",
                content:
                    "These buttons reset the map, open display controls, and switch map features.",
                placement: "left",
            },
            {
                target: "[data-tour='map-reset']",
                title: "Reset Map",
                content: "Use this to return the map to your configured home view.",
                placement: "left",
            },
            {
                target: "[data-tour='map-fullscreen']",
                title: "Fullscreen Map",
                content: "This expands the map for a larger operating view.",
                desktopOnly: true,
                optional: true,
                placement: "left",
            },
            {
                target: "[data-tour='map-controls-toggle']",
                title: "Open Map Controls",
                content: "Click this controls button to open the map display panel.",
                waitFor: "[data-tour='map-controls-panel']",
                buttons: action_buttons,
                placement: "left",
            },
            {
                target: "[data-tour='map-controls-panel']",
                title: "Display Panel",
                content:
                    "This panel contains map projection, overlays, and geographic display options.",
                placement: "left",
            },
            {
                target: "[data-tour='map-projection-toggle']",
                title: "Projection",
                content: "Switch between the globe and azimuthal projections here.",
                placement: "left",
            },
            {
                target: "[data-tour='map-night-toggle']",
                title: "Night Overlay",
                content: "Toggle the day/night terminator overlay for propagation context.",
                placement: "left",
            },
            {
                target: "[data-tour='map-equator-toggle']",
                title: "Equator",
                content: "This toggles the equator overlay.",
                placement: "left",
            },
            {
                target: "[data-tour='map-overlays']",
                title: "Zone Overlays",
                content:
                    "Use these overlays for DXCC labels, CQ zones, ITU zones, or grid squares.",
                placement: "left",
            },
            {
                target: "[data-tour='map-region-overlays']",
                title: "Regional Overlays",
                content: "These buttons add US state and Canada province overlays when useful.",
                placement: "left",
            },
            {
                target: "[data-tour='propagation-bars']",
                title: "Propagation",
                content: "These indicators summarize current A, K, and solar flux conditions.",
                optional: true,
                requires: "propagation_loaded",
                placement: "top",
            },
        ],
    },
    spots_table: {
        id: "spots_table",
        title: "Spots Table",
        description: "Learn the live spots table, search, sorting, and spot row fields.",
        steps: [
            {
                target: "[data-tour='mobile-main-tabs']",
                title: "Show The Table",
                content: "Tap the Table tab if the spots table is not currently visible.",
                mobileOnly: true,
                optional: true,
                waitFor: "[data-tour='spots-table']",
                buttons: action_buttons,
                placement: "bottom",
                skipBeacon: true,
            },
            {
                target: "[data-tour='table-panel']",
                title: "Table View",
                content: "The table is the detailed sortable view of live spots.",
                desktopOnly: true,
                optional: true,
                placement: "left",
                skipBeacon: true,
            },
            {
                target: "[data-tour='spots-table']",
                title: "Spots Table",
                content:
                    "New spots appear here with callsign, frequency, band, mode, and comment data.",
                placement: "left",
            },
            {
                target: "[data-tour='table-search']",
                title: "Callsign Search",
                content:
                    "Search for a callsign here, then press Enter to create a show-only filter.",
                desktopOnly: true,
                optional: true,
                placement: "bottom",
            },
            {
                target: "[data-tour='table-search-mobile']",
                title: "Callsign Search",
                content:
                    "Search for a callsign here, then press Enter to create a show-only filter.",
                mobileOnly: true,
                optional: true,
                placement: "top",
            },
            {
                target: "[data-tour='table-search-single-spot-toggle']",
                title: "Single Spot Mode",
                content: "This toggles whether only the newest spot per station is shown.",
                desktopOnly: true,
                optional: true,
                placement: "bottom",
            },
            {
                target: "[data-tour='table-search-mobile-single-spot-toggle']",
                title: "Single Spot Mode",
                content: "This toggles whether only the newest spot per station is shown.",
                mobileOnly: true,
                optional: true,
                placement: "top",
            },
            {
                target: "[data-tour='table-header-row']",
                title: "Columns And Sorting",
                content: "Click sortable headers to change the table order.",
                placement: "bottom",
            },
            {
                target: "[data-tour='spot-row']",
                title: "Spot Row",
                content: "Each row is one received spot. Click a row to pin it on the map.",
                optional: true,
                requires: "has_spots",
                placement: "top",
            },
            {
                target: "[data-tour='spot-row-flag']",
                title: "Entity",
                content: "This cell shows the spotted station's country or entity.",
                optional: true,
                requires: "has_spots",
                placement: "top",
            },
            {
                target: "[data-tour='spot-row-dx-callsign']",
                title: "DX Callsign",
                content: "The DX callsign links to its QRZ page and can be highlighted by alerts.",
                optional: true,
                requires: "has_spots",
                placement: "top",
            },
            {
                target: "[data-tour='spot-row-frequency']",
                title: "Frequency",
                content: "Click the frequency to send mode and frequency to the connected radio.",
                optional: true,
                requires: "has_spots",
                placement: "top",
            },
            {
                target: "[data-tour='spot-row-band']",
                title: "Band",
                content: "The band column helps you scan activity by band at a glance.",
                optional: true,
                requires: "has_spots",
                placement: "top",
            },
            {
                target: "[data-tour='spot-row-mode']",
                title: "Mode",
                content: "The mode column shows how the spot was classified.",
                optional: true,
                requires: "has_spots",
                placement: "top",
            },
            {
                target: "[data-tour='spot-row-comment']",
                title: "Comment",
                content: "On wide screens, comments provide extra spot details and references.",
                desktopOnly: true,
                optional: true,
                requires: "has_spots",
                placement: "top",
            },
        ],
    },
};

export function get_tour_chapter(chapter_id) {
    return TOUR_CHAPTERS[chapter_id] ?? null;
}
