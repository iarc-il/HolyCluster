import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({
        colors: {
            theme: {
                borders: "gray",
                disabled_text: "gray",
                input_background: "white",
                modals: "white",
                text: "black",
            },
        },
    }),
}));
vi.mock("@/hooks/useFilters", () => ({
    useFilters: () => ({
        get_filter_add_status: () => ({ status: "add" }),
    }),
}));
vi.mock("@/hooks/useUiRefresh.jsx", () => ({ useUiRefreshBlocker: () => {} }));

import FilterModal from "@/components/FilterModal.jsx";

afterEach(cleanup);

describe("FilterModal LoTW filter", () => {
    it("creates a DX LoTW user filter", async () => {
        const user = userEvent.setup();
        const on_apply = vi.fn();

        render(
            <FilterModal
                button={<button type="button">Open</button>}
                initial_data={{ action: "show_only", type: "prefix", value: "" }}
                on_apply={on_apply}
            />,
        );

        await user.click(screen.getByRole("button", { name: "Open" }));
        await user.click(document.querySelector("[data-tour='filter-modal-type-lotw']"));
        expect(screen.queryByRole("combobox")).toBeNull();
        await user.click(screen.getByRole("button", { name: "Apply" }));

        expect(on_apply).toHaveBeenCalledWith({
            action: "show_only",
            type: "lotw",
        });
    });
});
