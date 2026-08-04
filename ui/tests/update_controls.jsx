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
    return { ok, status: ok ? 200 : 500, json: async () => payload };
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
    });

    it("installs after accepting the update prompt", async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(
                response({ status: "available", version: { local: "1.0.0", remote: "1.1.0" } }),
            )
            .mockResolvedValueOnce(
                response({ status: "installing", version: { local: "1.0.0", remote: "1.1.0" } }),
            );
        vi.stubGlobal("fetch", fetch);

        render_updates();
        await userEvent.click(await screen.findByRole("button", { name: "Update" }));
        await waitFor(() =>
            expect(fetch).toHaveBeenLastCalledWith("/update/install", expect.any(Object)),
        );
    });

    it("keeps a declined update visible and installable later", async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(
                response({ status: "available", version: { local: "1.0.0", remote: "1.1.0" } }),
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
            expect(fetch).toHaveBeenLastCalledWith("/update/install", expect.any(Object)),
        );
    });

    it("offers retry after a failed update check", async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(
                response({ status: "current", version: { local: "1.0.0", remote: "1.0.0" } }),
            )
            .mockResolvedValueOnce(response({}, false))
            .mockResolvedValueOnce(
                response({ status: "current", version: { local: "1.0.0", remote: "1.0.0" } }),
            );
        vi.stubGlobal("fetch", fetch);

        render_updates();
        await screen.findByText("CAT Control is up to date.");
        await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
        expect(await screen.findByRole("button", { name: "Retry update" })).not.toBeNull();
        await userEvent.click(screen.getByRole("button", { name: "Retry update" }));
        await waitFor(() =>
            expect(fetch).toHaveBeenLastCalledWith("/update/retry", expect.any(Object)),
        );
    });
});
