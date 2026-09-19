import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cat = vi.hoisted(() => ({ current: null }));

vi.mock("@/hooks/useRadio", () => ({
    default: () => cat.current,
}));

import UpdateControls, { UpdateConsentDialog } from "@/components/UpdateControls.jsx";
import {
    UpdateProvider,
    compare_update_versions,
    normalize_update_status,
} from "@/hooks/useUpdate.jsx";
import { NATIVE_UPDATER_MIN_VERSION } from "@/utils/cat_features.js";

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

beforeEach(() => {
    cat.current = {
        local_version: [...NATIVE_UPDATER_MIN_VERSION],
        is_radio_available: () => true,
    };
});

describe("CAT Control updates", () => {
    it("does not poll or render native controls without a CAT connection", async () => {
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);
        cat.current = {
            local_version: null,
            is_radio_available: () => false,
        };

        render_updates();
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(fetch).not.toHaveBeenCalled();
        expect(screen.queryByRole("heading", { name: "CAT Control updates" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    });

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
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" }),
        );

        render_updates();

        expect(
            await screen.findByText("CAT Control update information is unavailable."),
        ).not.toBeNull();
    });

    it("installs after accepting the update prompt", async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(
                response({ state: "available", available_version: "1.1.0", diagnostic: null }),
            )
            .mockResolvedValueOnce(response({ state: "installing", available_version: "1.1.0" }));
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
            .mockResolvedValueOnce(response({ state: "available", available_version: "1.1.0" }))
            .mockResolvedValueOnce(
                response({ status: "deferred", version: { local: "1.0.0", remote: "1.1.0" } }),
            )
            .mockResolvedValueOnce(
                response({ status: "installing", version: { local: "1.0.0", remote: "1.1.0" } }),
            );
        vi.stubGlobal("fetch", fetch);

        render_updates();
        await userEvent.click(await screen.findByRole("button", { name: "Later" }));
        expect(await screen.findByText("CAT Control update available.")).not.toBeNull();
        await userEvent.click(screen.getByRole("button", { name: "Install update" }));
        await waitFor(() =>
            expect(fetch).toHaveBeenLastCalledWith("/api/update/install", expect.any(Object)),
        );
    });

    it("offers retry after a failed update check", async () => {
        const fetch = vi
            .fn()
            .mockResolvedValueOnce(response({ state: "idle" }))
            .mockResolvedValueOnce(response({}, false))
            .mockResolvedValueOnce(response({ state: "idle" }));
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
