import { fullscreen_portal_target } from "@/utils/fullscreen_portal.js";
import { describe, expect, it } from "vitest";

describe("fullscreen_portal_target", () => {
    it("uses the document body while the fullscreen element is unavailable", () => {
        expect(fullscreen_portal_target(true, null, document.body)).toBe(document.body);
    });

    it("uses the fullscreen element when it is available", () => {
        const fullscreen_element = document.createElement("div");
        expect(fullscreen_portal_target(true, fullscreen_element, document.body)).toBe(
            fullscreen_element,
        );
    });

    it("uses the document body outside fullscreen", () => {
        const fullscreen_element = document.createElement("div");
        expect(fullscreen_portal_target(false, fullscreen_element, document.body)).toBe(
            document.body,
        );
    });
});
