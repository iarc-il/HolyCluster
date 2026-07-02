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

    it("has stable target selectors for every step", () => {
        for (const { chapter, step } of all_steps()) {
            expect(step.target, `${chapter.id}: ${step.title}`).toMatch(/^\[data-tour='[^']+'\]$/);
            expect(step_text(step), `${chapter.id}: ${step.title}`).not.toContain("dev_mode");
        }
    });
});
