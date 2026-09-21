import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import RotatorState from "@/components/RotatorState.jsx";

afterEach(cleanup);

describe("RotatorState", () => {
    it("shows a green indicator when connected", () => {
        render(<RotatorState status="connected" name="Hamlib rotator" />);

        const indicator = screen.getByRole("img", { name: "Rotator connected" });
        expect(indicator.querySelector("g").getAttribute("stroke")).toBe("#00EE00");
    });

    it("shows a red indicator when disconnected", () => {
        render(<RotatorState status="disconnected" name="Hamlib rotator" />);

        const indicator = screen.getByRole("img", { name: "Rotator disconnected" });
        expect(indicator.querySelector("g").getAttribute("stroke")).toBe("#EE0000");
    });

    it("points the needle at the rotator azimuth", () => {
        render(<RotatorState status="connected" name="Hamlib rotator" azimuth={135} />);

        const indicator = screen.getByRole("img", { name: "Rotator connected" });
        expect(indicator.querySelector("g g").getAttribute("transform")).toBe("rotate(135 12 12)");
    });

    it.each([
        ["unavailable", ""],
        ["disconnected", "unconfigured"],
    ])("does not render for %s status with %s name", (status, name) => {
        render(<RotatorState status={status} name={name} />);

        expect(screen.queryByRole("img")).toBeNull();
    });
});
