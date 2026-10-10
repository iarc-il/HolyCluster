import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({
        colors: {
            theme: { borders: "gray", modals: "white", text: "black" },
        },
    }),
}));

import Button from "@/components/ui/Button.jsx";
import Modal from "@/components/ui/Modal.jsx";

afterEach(cleanup);

describe("Modal keyboard handling", () => {
    it("closes a modal when Escape is pressed outside its content", async () => {
        const user = userEvent.setup();

        render(<Modal button={<Button>Open</Button>}>Content</Modal>);
        await user.click(screen.getByRole("button", { name: "Open" }));

        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("closes only the topmost nested modal on Escape", async () => {
        const user = userEvent.setup();

        render(
            <Modal button={<Button>Open parent</Button>} on_cancel={() => {}}>
                <Modal
                    button={<Button>Open child</Button>}
                    title={<h2>Child</h2>}
                    on_cancel={() => {}}
                >
                    <button data-autofocus>Child action</button>
                </Modal>
            </Modal>,
        );

        await user.click(screen.getByRole("button", { name: "Open parent" }));
        await user.click(screen.getByRole("button", { name: "Open child" }));
        expect(screen.getAllByRole("dialog")).toHaveLength(2);

        await user.keyboard("{Escape}");
        expect(screen.getAllByRole("dialog")).toHaveLength(1);

        await user.keyboard("{Escape}");
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});

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
