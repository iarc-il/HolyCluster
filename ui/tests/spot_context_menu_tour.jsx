import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SpotContextMenu from "@/components/SpotContextMenu.jsx";

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({
        colors: {
            buttons: {
                active_tab: "#222222",
            },
            theme: {
                background: "#000000",
                border: "#333333",
                text: "#ffffff",
            },
        },
    }),
}));

describe("SpotContextMenu tour integration", () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it("ignores tooltip clicks but closes on overlay clicks", () => {
        const on_close = vi.fn();

        render(
            <>
                <div id="react-joyride-portal">
                    <div className="react-joyride__floater">
                        <button type="button">Joyride back</button>
                    </div>
                    <button type="button" className="react-joyride__overlay">
                        Tour overlay
                    </button>
                </div>
                <SpotContextMenu
                    x={10}
                    y={10}
                    on_close={on_close}
                    spot={{ id: 1 }}
                    actions={[{ label: "Pin Spot", onClick: vi.fn() }]}
                />
            </>,
        );

        expect(screen.getByText("Pin Spot")).not.toBeNull();

        fireEvent.mouseDown(screen.getByRole("button", { name: "Joyride back" }));

        expect(on_close).not.toHaveBeenCalled();

        fireEvent.mouseDown(screen.getByRole("button", { name: "Tour overlay" }));

        expect(on_close).toHaveBeenCalledTimes(1);
    });

    it("handles Escape before the tour does", () => {
        const on_close = vi.fn();
        const on_tour_escape = vi.fn();
        document.body.addEventListener("keydown", on_tour_escape);

        render(
            <SpotContextMenu
                x={10}
                y={10}
                on_close={on_close}
                spot={{ id: 1 }}
                actions={[{ label: "Pin Spot", onClick: vi.fn() }]}
            />,
        );

        fireEvent.keyDown(document.body, { key: "Escape" });
        document.body.removeEventListener("keydown", on_tour_escape);

        expect(on_close).toHaveBeenCalledTimes(1);
        expect(on_tour_escape).not.toHaveBeenCalled();
    });
});
