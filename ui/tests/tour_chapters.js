import { describe, expect, it } from "vitest";
import { TOUR_CHAPTERS } from "../src/components/tour/tour_chapters.jsx";

const dev_only_selectors = [
    "top-bar-profile-selector",
    "top-bar-cluster-stats",
    "map-history-toggle",
    "map-voacap-controls",
    "map-voacap-toggle",
    "map-voacap-band",
    "settings-tab-layout",
    "settings-tab-profiles",
    "settings-filter-url-sharing",
    "submit-spot-testing-only",
];

function all_steps() {
    return Object.values(TOUR_CHAPTERS).flatMap(chapter =>
        chapter.steps.map(step => ({ chapter, step })),
    );
}

function step_text(step) {
    return JSON.stringify(step);
}

describe("tour chapters", () => {
    it("defines non-empty manual chapters", () => {
        for (const chapter of Object.values(TOUR_CHAPTERS)) {
            expect(chapter.id).toBeTruthy();
            expect(chapter.title).toBeTruthy();
            expect(chapter.description).toBeTruthy();
            expect(chapter.steps.length).toBeGreaterThan(0);
        }
    });

    it("does not include dev-only tour targets", () => {
        const tour_text = JSON.stringify(TOUR_CHAPTERS);

        for (const selector of dev_only_selectors) {
            expect(tour_text).not.toContain(selector);
        }
    });

    it("requires user action for wait steps", () => {
        for (const { chapter, step } of all_steps()) {
            if (!step.waitFor && !step.waitForGone && !step.waitForChange) continue;

            expect(step.buttons, `${chapter.id}: ${step.title}`).toBeDefined();
            expect(step.buttons, `${chapter.id}: ${step.title}`).not.toContain("primary");
            expect(step.buttons, `${chapter.id}: ${step.title}`).not.toContain("skip");
        }
    });

    it("asks users to try safe map controls", () => {
        const interactive_targets = TOUR_CHAPTERS.map.steps
            .filter(step => step.waitForChange)
            .map(step => step.target);

        expect(interactive_targets).toContain("[data-tour='map-projection-toggle']");
        expect(interactive_targets).toContain("[data-tour='map-night-toggle']");
        expect(interactive_targets).toContain("[data-tour='map-equator-toggle']");
        expect(interactive_targets).toContain("[data-tour='map-overlay-dxcc']");
        expect(interactive_targets).toContain("[data-tour='map-region-overlay-us_state']");
    });

    it("introduces the mobile GPS control before reset", () => {
        const map_steps = TOUR_CHAPTERS.map.steps;
        const gps_index = map_steps.findIndex(step => step.target === "[data-tour='map-gps']");
        const reset_index = map_steps.findIndex(step => step.target === "[data-tour='map-reset']");

        expect(gps_index).toBe(reset_index - 1);
        expect(map_steps[gps_index]?.mobileOnly).toBe(true);
    });

    it("orders the map display controls", () => {
        const map_titles = TOUR_CHAPTERS.map.steps.map(step => step.title);
        const display_panel_index = map_titles.indexOf("Display Panel");

        expect(map_titles.slice(display_panel_index, display_panel_index + 4)).toEqual([
            "Display Panel",
            "Try Night Overlay",
            "Try Projection",
            "Try Equator",
        ]);
    });

    it("asks users to try safe table controls", () => {
        const interactive_targets = TOUR_CHAPTERS.spots_table.steps
            .filter(step => step.waitForChange)
            .map(step => step.target);

        expect(interactive_targets).toContain("[data-tour='table-search-single-spot-toggle']");
        expect(interactive_targets).toContain(
            "[data-tour='table-search-mobile-single-spot-toggle']",
        );
        expect(interactive_targets).toContain("[data-tour='table-header-dx_callsign']");
        expect(interactive_targets).toContain("[data-tour='spot-row']");
    });

    it("asks users to right-click table callsigns and flags", () => {
        const context_menu_steps = TOUR_CHAPTERS.spots_table.steps.filter(step =>
            step.waitFor?.startsWith("[data-tour='table-context-menu']"),
        );
        const targets = context_menu_steps.map(step => step.target);
        const waits = context_menu_steps.map(step => step.waitFor);

        expect(targets).toContain("[data-tour='spot-row-dx-callsign']");
        expect(targets).toContain("[data-tour='spot-row-flag']");
        expect(waits).toContain("[data-tour='table-context-menu'][data-tour-state='callsign']");
        expect(waits).toContain("[data-tour='table-context-menu'][data-tour-state='flag']");
    });

    it("keeps dynamic table context menu targets available", () => {
        const context_menu_target_steps = TOUR_CHAPTERS.spots_table.steps.filter(
            step => step.target === "[data-tour='table-context-menu']",
        );

        expect(context_menu_target_steps.length).toBeGreaterThan(0);
        for (const step of context_menu_target_steps) {
            expect(step.optional, step.title).not.toBe(true);
        }
    });

    it("asks users to try safe filter controls", () => {
        const interactive_targets = TOUR_CHAPTERS.filters.steps
            .filter(step => step.waitForChange)
            .map(step => step.target);

        expect(interactive_targets).toContain("[data-tour='band-filter-20']");
        expect(interactive_targets).toContain("[data-tour='mode-filter-SSB']");
    });

    it("lets already-active side panel tab steps continue", () => {
        const side_panel_tab_steps = all_steps().filter(({ step }) =>
            step.target.startsWith("[data-tour='side-panel-tab-"),
        );

        for (const { chapter, step } of side_panel_tab_steps) {
            expect(step.waitForChange, `${chapter.id}: ${step.title}`).toEqual({
                selector: step.target,
                attribute: "data-tour-state",
                satisfiedValue: "active",
            });
        }
    });

    it("lets already-active settings tab steps continue", () => {
        const settings_tab_targets = [
            "[data-tour='settings-tab-cat-control']",
            "[data-tour='settings-tab-bands-modes']",
            "[data-tour='settings-tab-import-export']",
        ];

        for (const target of settings_tab_targets) {
            const step = TOUR_CHAPTERS.settings.steps.find(
                candidate => candidate.target === target,
            );
            expect(step, target).toBeDefined();
            expect(step.waitForChange, target).toEqual({
                selector: target,
                attribute: "data-tour-state",
                satisfiedValue: "active",
            });
        }
    });

    it("uses mobile-safe placement for tall settings content steps", () => {
        const tall_content_targets = [
            "[data-tour='settings-modal-content']",
            "[data-tour='settings-cat-control']",
            "[data-tour='settings-bands-modes']",
            "[data-tour='settings-import-export']",
        ];

        for (const target of tall_content_targets) {
            const step = TOUR_CHAPTERS.settings.steps.find(
                candidate => candidate.target === target,
            );
            expect(step, target).toBeDefined();
            expect(step?.mobilePlacement, target).toBe("center");
        }
    });

    it("uses mobile-safe placement for large overview panels", () => {
        const large_panel_targets = [
            ["quick_start", "[data-tour='left-column']"],
            ["filters", "[data-tour='left-column']"],
            ["filters", "[data-tour='filters-panel']"],
            ["side_panel", "[data-tour='side-panel']"],
            ["side_panel", "[data-tour='side-panel-view-filters']"],
            ["side_panel", "[data-tour='band-bar-panel']"],
            ["side_panel", "[data-tour='band-bar-chart']"],
            ["side_panel", "[data-tour='heatmap-panel']"],
            ["side_panel", "[data-tour='dxpeditions-panel']"],
            ["side_panel", "[data-tour='dxpeditions-summary']"],
            ["side_panel", "[data-tour='dxpeditions-filter']"],
            ["side_panel", "[data-tour='dxpeditions-sort']"],
            ["side_panel", "[data-tour='hunter-panel']"],
            ["side_panel", "[data-tour='hunter-adif-import']"],
        ];

        for (const [chapter_id, target] of large_panel_targets) {
            const step = TOUR_CHAPTERS[chapter_id].steps.find(
                candidate => candidate.target === target,
            );
            expect(step, `${chapter_id}: ${target}`).toBeDefined();
            expect(step?.mobilePlacement, `${chapter_id}: ${target}`).toBe("center");
        }
    });

    it("keeps interactive mobile placements target-clickable", () => {
        const interactive_mobile_targets = [
            ["quick_start", "[data-tour='mobile-main-tabs']", "center"],
            ["map", "[data-tour='mobile-main-tabs']", "center"],
            ["spots_table", "[data-tour='mobile-main-tabs']", "center"],
            ["spots_table", "[data-tour='table-header-dx_callsign']", "auto"],
            ["spots_table", "[data-tour='spot-row']", "auto"],
            ["spots_table", "[data-tour='spot-row-dx-callsign']", "auto"],
            ["spots_table", "[data-tour='spot-row-flag']", "auto"],
            ["spots_table", "[data-tour='spot-row-frequency']", "auto"],
            ["spots_table", "[data-tour='spot-row-mode']", "auto"],
            ["filters", "[data-tour='band-filter-20']", "auto"],
            ["filters", "[data-tour='filter-options-trigger-bands-20']", "auto"],
            ["filters", "[data-tour='mode-filter-SSB']", "auto"],
            ["side_panel", "[data-tour='side-panel-tab-filters']", "auto"],
            ["side_panel", "[data-tour='side-panel-tab-band-bar']", "auto"],
            ["side_panel", "[data-tour='side-panel-tab-heatmap']", "auto"],
            ["side_panel", "[data-tour='side-panel-tab-dxpeditions']", "auto"],
            ["side_panel", "[data-tour='side-panel-tab-missing']", "auto"],
        ];

        for (const [chapter_id, target, placement] of interactive_mobile_targets) {
            const step = TOUR_CHAPTERS[chapter_id].steps.find(
                candidate => candidate.target === target,
            );
            const effective_mobile_placement = step?.mobilePlacement ?? step?.placement;
            expect(step, `${chapter_id}: ${target}`).toBeDefined();
            expect(effective_mobile_placement, `${chapter_id}: ${target}`).toBe(placement);
            if (effective_mobile_placement === "center") {
                expect(step?.mobileHideOverlay, `${chapter_id}: ${target}`).toBe(true);
            }
        }
    });

    it("scrolls mobile table row targets below the fixed top bar", () => {
        const row_targets = [
            "[data-tour='spot-row']",
            "[data-tour='spot-row-dx-callsign']",
            "[data-tour='spot-row-flag']",
            "[data-tour='spot-row-frequency']",
            "[data-tour='spot-row-band']",
            "[data-tour='spot-row-mode']",
        ];

        for (const target of row_targets) {
            const step = TOUR_CHAPTERS.spots_table.steps.find(
                candidate => candidate.target === target,
            );
            expect(step, target).toBeDefined();
            expect(step?.mobileScrollOffset, target).toBeGreaterThanOrEqual(80);
            expect(step?.skipScroll, target).toBe(true);
            expect(step?.before, target).toBeTypeOf("function");
        }
    });

    it("lets the settings close step choose an in-viewport side", () => {
        const close_step = TOUR_CHAPTERS.settings.steps.find(
            step => step.target === "[data-tour='modal-close-button']",
        );

        expect(close_step).toBeDefined();
        expect(close_step?.placement).toBe("auto");
    });

    it("disables the mobile overlay for touch-sensitive tour steps", () => {
        const touch_sensitive_targets = [
            ["quick_start", "[data-tour='mobile-main-tabs']"],
            ["map", "[data-tour='mobile-main-tabs']"],
            ["spots_table", "[data-tour='mobile-main-tabs']"],
            ["filters", "[data-tour='filter-options-trigger-bands-20']"],
            ["filters", "[data-tour='filter-modal-text-value']"],
            ["filters", "[data-tour='modal-apply-button']"],
            ["filters", "[data-tour='filter-line-alert']"],
            ["settings", "[data-tour='modal-close-button']"],
        ];

        for (const [chapter_id, target] of touch_sensitive_targets) {
            const step = TOUR_CHAPTERS[chapter_id].steps.find(
                candidate => candidate.target === target,
            );
            expect(step, `${chapter_id}: ${target}`).toBeDefined();
            expect(step?.mobileHideOverlay, `${chapter_id}: ${target}`).toBe(true);
        }
    });

    it("highlights interactive spot row targets on mobile", () => {
        const highlighted_targets = [
            "[data-tour='spot-row']",
            "[data-tour='spot-row-dx-callsign']",
            "[data-tour='spot-row-flag']",
        ];

        for (const target of highlighted_targets) {
            const step = TOUR_CHAPTERS.spots_table.steps.find(
                candidate => candidate.target === target,
            );
            expect(step?.mobileHideOverlay, target).not.toBe(true);
        }
    });

    it("targets visible settings modal content for dialog overview steps", () => {
        const settings_open_step = TOUR_CHAPTERS.settings.steps.find(
            step => step.target === "[data-tour='top-bar-settings']",
        );
        const settings_dialog_step = TOUR_CHAPTERS.settings.steps.find(
            step => step.title === "Settings Dialog",
        );

        expect(settings_open_step?.waitFor).toBe("[data-tour='settings-modal-content']");
        expect(settings_dialog_step?.target).toBe("[data-tour='settings-modal-content']");
    });

    it("keeps DXpeditions panel steps required", () => {
        const dxpeditions_targets = [
            "[data-tour='dxpeditions-panel']",
            "[data-tour='dxpeditions-summary']",
            "[data-tour='dxpeditions-filter']",
            "[data-tour='dxpeditions-sort']",
        ];

        for (const target of dxpeditions_targets) {
            const step = TOUR_CHAPTERS.side_panel.steps.find(
                candidate => candidate.target === target,
            );
            expect(step, target).toBeDefined();
            expect(step.optional, target).not.toBe(true);
        }
    });

    it("asks users to open the band ONLY/ALL popup", () => {
        const hover_step = TOUR_CHAPTERS.filters.steps.find(
            step => step.target === "[data-tour='filter-options-trigger-bands-20']",
        );
        const popup_step = TOUR_CHAPTERS.filters.steps.find(
            step => step.target === "[data-tour='filter-options-popup']",
        );

        expect(hover_step?.waitFor).toBe(
            "[data-tour='filter-options-popup'][data-tour-state='bands-20']",
        );
        expect(popup_step?.forceFilterOptions).toEqual({
            filter_key: "bands",
            filter_value: 20,
        });
        expect(popup_step?.waitForGone).toBeUndefined();
        expect(hover_step?.optional).not.toBe(true);
        expect(popup_step?.optional).not.toBe(true);
    });

    it("keeps sidebar filter steps available after opening the rail", () => {
        const sidebar_targets = [
            "[data-tour='left-column']",
            "[data-tour='band-filter-20']",
            "[data-tour='filter-options-trigger-bands-20']",
            "[data-tour='filter-options-popup']",
            "[data-tour='mode-filter-SSB']",
        ];

        for (const target of sidebar_targets) {
            const step = TOUR_CHAPTERS.filters.steps.find(candidate => candidate.target === target);
            expect(step, target).toBeDefined();
            expect(step.optional, target).not.toBe(true);
        }
    });

    it("keeps dynamic advanced filter flow targets available", () => {
        const modal_targets = [
            "[data-tour='side-panel-tab-filters']",
            "[data-tour='filters-panel']",
            "[data-tour='filter-section-alert']",
            "[data-tour='filter-section-show_only']",
            "[data-tour='filter-section-hide']",
            "[data-tour='add-filter-button-alert']",
            "[data-tour='filter-modal-content']",
            "[data-tour='filter-modal-action-alert']",
            "[data-tour='filter-modal-type-prefix']",
            "[data-tour='filter-modal-spot-role-dx']",
            "[data-tour='filter-modal-text-value']",
            "[data-tour='modal-apply-button']",
            "[data-tour='filter-line-alert']",
        ];

        for (const target of modal_targets) {
            const step = TOUR_CHAPTERS.filters.steps.find(candidate => candidate.target === target);
            expect(step, target).toBeDefined();
            expect(step.optional, target).not.toBe(true);
        }
    });

    it("asks users to add and drag an advanced filter", () => {
        const value_step = TOUR_CHAPTERS.filters.steps.find(
            step => step.target === "[data-tour='filter-modal-text-value']",
        );
        const apply_step = TOUR_CHAPTERS.filters.steps.find(
            step => step.target === "[data-tour='modal-apply-button']",
        );
        const drag_step = TOUR_CHAPTERS.filters.steps.find(
            step => step.target === "[data-tour='filter-line-alert']",
        );

        expect(value_step?.waitForChange).toBeUndefined();
        expect(apply_step?.waitForChange).toEqual({
            selector: "[data-tour='filter-section-alert']",
            attribute: "data-tour-state",
        });
        expect(drag_step?.waitForChange).toEqual({
            selector: "[data-tour='filter-section-show_only']",
            attribute: "data-tour-state",
        });
    });

    it("has stable target selectors for every step", () => {
        for (const { chapter, step } of all_steps()) {
            expect(step.target, `${chapter.id}: ${step.title}`).toMatch(/^\[data-tour='[^']+'\]$/);
            expect(step_text(step), `${chapter.id}: ${step.title}`).not.toContain("dev_mode");
        }
    });
});
