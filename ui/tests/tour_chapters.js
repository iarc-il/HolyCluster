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
            if (!step.waitFor && !step.waitForGone) continue;

            expect(step.buttons, `${chapter.id}: ${step.title}`).toBeDefined();
            expect(step.buttons, `${chapter.id}: ${step.title}`).not.toContain("primary");
            expect(step.buttons, `${chapter.id}: ${step.title}`).not.toContain("skip");
        }
    });

    it("has stable target selectors for every step", () => {
        for (const { chapter, step } of all_steps()) {
            expect(step.target, `${chapter.id}: ${step.title}`).toMatch(/^\[data-tour='[^']+'\]$/);
            expect(step_text(step), `${chapter.id}: ${step.title}`).not.toContain("dev_mode");
        }
    });
});
