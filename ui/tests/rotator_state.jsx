import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import RotatorState from "@/components/RotatorState.jsx";

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({
        colors: {
            rotator: {
                connected: "#00EE00",
                disconnected: "#EE0000",
                inactive: "#9ca3af",
                moving: "#facc15",
                moving_flash: "#ffffff",
            },
        },
    }),
}));

afterEach(cleanup);

describe("RotatorState", () => {
    it("shows a green indicator when connected", () => {
        render(<RotatorState status="connected" name="Hamlib rotator" />);

        const indicator = screen.getByRole("img", { name: "Rotator connected" });
        expect(indicator.getAttribute("color")).toBe("#00EE00");
    });

    it("shows a red indicator when disconnected", () => {
        render(<RotatorState status="disconnected" name="Hamlib rotator" />);

        const indicator = screen.getByRole("img", { name: "Rotator disconnected" });
        expect(indicator.getAttribute("color")).toBe("#EE0000");
    });

    it("points the needle at the rotator azimuth", () => {
        render(<RotatorState status="connected" name="Hamlib rotator" azimuth={135} />);

        const indicator = screen.getByRole("img", { name: "Rotator connected" });
        expect(indicator.querySelector("g g").getAttribute("transform")).toBe("rotate(135 12 12)");
    });

    it("shows a gray button when tuning is inactive", () => {
        render(
            <RotatorState
                status="connected"
                name="Hamlib rotator"
                tuning_enabled={false}
                on_click={() => {}}
            />,
        );

        const button = screen.getByRole("button", { name: "Enable rotator tuning" });
        expect(button.getAttribute("aria-pressed")).toBe("false");
        expect(screen.getByRole("img").getAttribute("color")).toBe("#9ca3af");
    });

    it("calls the toggle handler when pressed", async () => {
        const on_click = vi.fn();
        render(
            <RotatorState
                status="connected"
                name="Hamlib rotator"
                tuning_enabled={true}
                on_click={on_click}
            />,
        );

        screen.getByRole("button", { name: "Disable rotator tuning" }).click();
        expect(on_click).toHaveBeenCalledOnce();
    });

    it.each([
        ["unavailable", ""],
        ["disconnected", "unconfigured"],
    ])("does not render for %s status with %s name", (status, name) => {
        render(<RotatorState status={status} name={name} />);

        expect(screen.queryByRole("img")).toBeNull();
    });
});
