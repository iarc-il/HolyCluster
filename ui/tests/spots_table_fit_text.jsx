import { FitText } from "@/components/SpotsTable.jsx";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("FitText", () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it("does not refit unchanged text when its child element is recreated", () => {
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe() {}
                disconnect() {}
            },
        );
        const get_computed_style = vi
            .spyOn(globalThis, "getComputedStyle")
            .mockReturnValue({ fontSize: "14px" });
        vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
        vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(50);

        const { rerender } = render(
            <FitText value="K1ABC">
                <a href="/K1ABC">K1ABC</a>
            </FitText>,
        );
        expect(get_computed_style).toHaveBeenCalledTimes(1);

        rerender(
            <FitText value="K1ABC">
                <a href="/K1ABC">K1ABC</a>
            </FitText>,
        );
        expect(get_computed_style).toHaveBeenCalledTimes(1);

        rerender(
            <FitText value="K2XYZ">
                <a href="/K2XYZ">K2XYZ</a>
            </FitText>,
        );
        expect(get_computed_style).toHaveBeenCalledTimes(2);
    });
});
