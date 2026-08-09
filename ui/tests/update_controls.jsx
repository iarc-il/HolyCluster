import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import UpdateControls, { UpdateConsentDialog } from "@/components/UpdateControls.jsx";
import {
    UpdateProvider,
    compare_update_versions,
    normalize_update_status,
} from "@/hooks/useUpdate.jsx";

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({ colors: { theme: { text: "#fff", modals: "#111", borders: "#333" } } }),
}));

function response(payload, ok = true) {
    return {
        ok,
        status: ok ? 200 : 500,
        text: async () => JSON.stringify(payload),
    };
}

function render_updates() {
    return render(
        <UpdateProvider>
            <UpdateConsentDialog />
            <UpdateControls />
        </UpdateProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("CAT Control updates", () => {
    it("only treats a newer remote version as an update", () => {
        expect(compare_update_versions("1.2.0", "1.3.0")).toBeGreaterThan(0);
        expect(compare_update_versions("1.3.0", "1.3.0")).toBe(0);
        expect(compare_update_versions("1.4.0", "1.3.0")).toBeLessThan(0);
        expect(
            normalize_update_status({
                status: "available",
                version: { local_version: "1.4.0", remote_version: "1.3.0" },
            }).status,
        ).toBe("newer_local");
        expect(
            normalize_update_status({
                status: "available",
                version: { local: "bad", remote: "bad" },
            }).status,
        ).toBe("malformed");
        expect(
            normalize_update_status({
                state: "idle",
                available_version: null,
                diagnostic: null,
            }).status,
        ).toBe("current");
    });

    it("handles an empty update response", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" }));

        render_updates();

        expect(await screen.findByText("CAT Control update information is unavailable.")).not.toBeNull();
    });

    it("installs after accepting the update prompt", async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(
                response({ state: "available", available_version: "1.1.0", diagnostic: null }),
            )
            .mockResolvedValueOnce(
                response({ state: "installing", available_version: "1.1.0" }),
            );
        vi.stubGlobal("fetch", fetch);

        render_updates();
        await userEvent.click(await screen.findByRole("button", { name: "Update" }));
        await waitFor(() =>
            expect(fetch).toHaveBeenLastCalledWith("/api/update/install", expect.any(Object)),
        );
    });

    it("keeps a declined update visible and installable later", async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(
                response({ state: "available", available_version: "1.1.0" }),
            )
            .mockResolvedValueOnce(
                response({ status: "deferred", version: { local: "1.0.0", remote: "1.1.0" } }),
            )
            .mockResolvedValueOnce(
                response({ status: "installing", version: { local: "1.0.0", remote: "1.1.0" } }),
            );
        vi.stubGlobal("fetch", fetch);

        render_updates();
        await userEvent.click(await screen.findByRole("button", { name: "Later" }));
        expect(await screen.findByText(/You chose to install it later/)).not.toBeNull();
        await userEvent.click(screen.getByRole("button", { name: "Install update" }));
        await waitFor(() =>
            expect(fetch).toHaveBeenLastCalledWith("/api/update/install", expect.any(Object)),
        );
    });

    it("offers retry after a failed update check", async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(
                response({ state: "idle" }),
            )
            .mockResolvedValueOnce(response({}, false))
            .mockResolvedValueOnce(
                response({ state: "idle" }),
            );
        vi.stubGlobal("fetch", fetch);

        render_updates();
        await screen.findByText("CAT Control is up to date.");
        await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
        expect(await screen.findByRole("button", { name: "Retry update" })).not.toBeNull();
        await userEvent.click(screen.getByRole("button", { name: "Retry update" }));
        await waitFor(() =>
            expect(fetch).toHaveBeenLastCalledWith("/api/update/retry", expect.any(Object)),
        );
    });
});
