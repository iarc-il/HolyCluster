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

    it("does not close when the tour controls are clicked", () => {
        const on_close = vi.fn();

        render(
            <>
                <div id="react-joyride-portal">
                    <button type="button">Joyride back</button>
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

        fireEvent.mouseDown(document.body);

        expect(on_close).toHaveBeenCalledTimes(1);
    });
});
