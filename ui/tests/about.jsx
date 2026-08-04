import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import About from "@/components/About.jsx";

const color_context = {
    colors: {
        buttons: {
            utility: "#ffffff",
        },
        theme: {
            borders: "#333333",
            modals: "#111111",
            text: "#ffffff",
        },
    },
};

vi.mock("@/hooks/useColors", () => ({
    useColors: () => color_context,
}));

vi.mock("@/hooks/useColors.jsx", () => ({
    useColors: () => color_context,
}));

vi.mock("@/hooks/useRadio.jsx", () => ({
    default: () => ({
        new_version_available: false,
        raw_local_version: "catserver-v1.0.0",
        raw_remote_version: "catserver-v1.0.1",
    }),
}));

vi.mock("@/hooks/useUpdate.jsx", () => ({
    useUpdate: () => ({
        status: "current",
        local_version: "1.0.0",
        remote_version: "1.0.0",
        error: null,
        check: vi.fn(),
        install: vi.fn(),
        retry: vi.fn(),
        defer: vi.fn(),
    }),
}));

describe("About release notes", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        window.localStorage.clear();
    });

    it("does not open release notes for new users", async () => {
        render(<About />);

        await waitFor(() => {
            expect(window.localStorage.getItem("last_release")).not.toBeNull();
        });
        expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("opens release notes when a newer release is available", async () => {
        window.localStorage.setItem("last_release", JSON.stringify("previous-release"));

        render(<About />);

        expect(await screen.findByRole("dialog")).not.toBeNull();
        expect(screen.getByText("Release Notes")).not.toBeNull();
    });
});
