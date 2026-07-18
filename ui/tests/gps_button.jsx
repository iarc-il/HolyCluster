import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import GPSButton from "@/components/GPSButton.jsx";

function set_geolocation(getCurrentPosition) {
    Object.defineProperty(window.navigator, "geolocation", {
        configurable: true,
        value: getCurrentPosition == null ? undefined : { getCurrentPosition },
    });
}

describe("GPSButton", () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        set_geolocation(null);
    });

    it("calls back with coordinates and locator", async () => {
        const user = userEvent.setup();
        const on_location = vi.fn();
        const getCurrentPosition = vi.fn(success => {
            success({ coords: { latitude: 40, longitude: -75 } });
        });
        set_geolocation(getCurrentPosition);

        render(<GPSButton on_location={on_location} aria_label="Use GPS" className="gps-button" />);

        await user.click(screen.getByRole("button", { name: "Use GPS" }));

        expect(getCurrentPosition).toHaveBeenCalledWith(
            expect.any(Function),
            expect.any(Function),
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 60000,
            },
        );
        await waitFor(() => {
            expect(on_location).toHaveBeenCalledWith({
                latitude: 40,
                longitude: -75,
                locator: "FN20MA",
            });
        });
    });

    it("shows an unavailable title without geolocation", async () => {
        const user = userEvent.setup();
        const on_location = vi.fn();
        set_geolocation(null);

        render(<GPSButton on_location={on_location} aria_label="Use GPS" />);

        const button = screen.getByRole("button", { name: "Use GPS" });
        await user.click(button);

        expect(on_location).not.toHaveBeenCalled();
        expect(button.getAttribute("title")).toBe("GPS is not available");
    });
});
