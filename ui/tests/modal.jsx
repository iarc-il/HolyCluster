import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({
        colors: {
            theme: { borders: "gray", modals: "white", text: "black" },
        },
    }),
}));

import Button from "@/components/ui/Button.jsx";
import Modal from "@/components/ui/Modal.jsx";

describe("Modal Apply", () => {
    it("keeps the modal open when an async Apply fails", async () => {
        const user = userEvent.setup();
        let apply_result = false;
        const on_apply = vi.fn(async () => apply_result);

        render(
            <Modal button={<Button>Open</Button>} on_apply={on_apply} on_cancel={() => {}}>
                Content
            </Modal>,
        );

        await user.click(screen.getByRole("button", { name: "Open" }));
        await user.click(screen.getByRole("button", { name: "Apply" }));
        expect(on_apply).toHaveBeenCalledTimes(1);
        expect(screen.getByRole("dialog")).not.toBeNull();

        apply_result = true;
        await user.click(screen.getByRole("button", { name: "Apply" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });
});
