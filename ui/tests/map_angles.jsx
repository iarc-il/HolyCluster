import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MapAngles from "@/components/MapAngles.jsx";

const media = vi.hoisted(() => ({ is_desktop: true }));

vi.mock("@uidotdev/usehooks", () => ({
    useMediaQuery: () => media.is_desktop,
}));

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({ colors: { theme: { text: "#ffffff" } } }),
}));

function render_map_angles(radius) {
    return render(
        <svg>
            <MapAngles
                radius={radius}
                center_x={200}
                center_y={200}
                degrees_diff={15}
                hovered_azimuth={null}
            />
        </svg>,
    );
}

describe("map angle labels", () => {
    afterEach(() => {
        cleanup();
        media.is_desktop = true;
    });

    it("reduces the font size around a small map", () => {
        render_map_angles(120);

        expect(Number.parseFloat(screen.getByText("0°").getAttribute("font-size"))).toBeLessThan(
            18,
        );
    });

    it("keeps the full font size when the map has enough room", () => {
        render_map_angles(300);

        expect(screen.getByText("0°").getAttribute("font-size")).toBe("18px");
    });

    it("hides labels when they cannot remain readable without overlapping", () => {
        render_map_angles(40);

        expect(screen.queryByText("0°")).toBeNull();
    });

    it("keeps labels hidden on mobile viewports", () => {
        media.is_desktop = false;
        render_map_angles(300);

        expect(screen.queryByText("0°")).toBeNull();
    });
});
