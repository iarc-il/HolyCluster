import { ProfilesProvider, useProfiles } from "@/hooks/useProfiles.jsx";
import {
    LEGACY_PROFILE_STORE_KEY,
    PROFILE_STORE_BACKUP_KEY,
    PROFILE_STORE_KEY,
    create_profile_export,
    initialize_profile_store,
    sanitize_imported_profile,
    sanitize_profile_store,
} from "@/utils/profile_data.js";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitize_profile_store as sanitize_old_store } from "./fixtures/profiles/master_profile_data.mjs";

// Both real sanitizers use the same small CTY country-data fixture.
vi.mock("virtual:cty-dxcc-entities", () => ({
    default: ["United States", "Japan"],
    dxcc_code_entities: { 291: "United States", 339: "Japan" },
    dxcc_entities_by_code: {
        291: { raw_cty_name: "United States" },
        339: { raw_cty_name: "Japan" },
    },
}));

function old_store() {
    return sanitize_old_store({
        version: 1,
        active_profile_name: "Portable",
        profiles: ["Home", "Portable"].map(name => ({
            name,
            data: {
                settings: { callsign: name.toUpperCase() },
                filters: { time_limit: 7200 },
                hunter: {
                    worked: { dxcc: { global: [291, 339] }, us_state: { global: ["CA"] } },
                    imports: [{ id: "log", filename: "log.adi", imported_at: "2026-10-09" }],
                },
                history: { display_hours: 24 },
            },
        })),
    });
}

function save(key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
}

function read(key) {
    return JSON.parse(window.localStorage.getItem(key));
}

function progress(store) {
    return store.profiles.map(profile => profile.data.missing.worked.dxcc.global);
}

function ProgressHarness() {
    const { active_profile_data, update_active_profile_section } = useProfiles();
    return (
        <div>
            <span data-testid="progress">
                {JSON.stringify(active_profile_data.missing.worked.dxcc.global)}
            </span>
            <button type="button" onClick={() => update_active_profile_section("missing", {})}>
                Clear progress
            </button>
        </div>
    );
}

function mount() {
    return render(
        <MemoryRouter>
            <ProfilesProvider>
                <ProgressHarness />
            </ProfilesProvider>
        </MemoryRouter>,
    );
}

function storage_event(key, store) {
    save(key, store);
    window.dispatchEvent(
        new StorageEvent("storage", {
            key,
            newValue: JSON.stringify(store),
            storageArea: window.localStorage,
        }),
    );
}

describe("profile store migration across UI versions", () => {
    beforeEach(() => window.localStorage.clear());
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it("reproduces the destructive shared-key round trip with the production sanitizer", () => {
        const migrated = sanitize_profile_store(old_store());
        expect(progress(migrated)).toEqual([
            [291, 339],
            [291, 339],
        ]);
        expect(progress(sanitize_profile_store(sanitize_old_store(migrated)))).toEqual([[], []]);
    });

    it("migrates every profile once, backs up the exact original, and leaves old data intact", () => {
        const original = old_store();
        const raw = ` ${JSON.stringify(original)} `;
        window.localStorage.setItem(LEGACY_PROFILE_STORE_KEY, raw);
        const migrated = initialize_profile_store();
        expect(progress(migrated)).toEqual([
            [291, 339],
            [291, 339],
        ]);
        expect(migrated.active_profile_name).toBe("Portable");
        for (let index = 0; index < original.profiles.length; index += 1) {
            const { hunter, settings, filters, history } = original.profiles[index].data;
            const data = migrated.profiles[index].data;
            expect(data.missing).toEqual(hunter);
            expect(data.settings.callsign).toBe(settings.callsign);
            expect(data.filters).toEqual(filters);
            expect(data.history).toEqual(history);
            expect(data.map_controls.map_theme).toBe(settings.map_theme);
        }
        expect(window.localStorage.getItem(LEGACY_PROFILE_STORE_KEY)).toBe(raw);
        expect(window.localStorage.getItem(PROFILE_STORE_BACKUP_KEY)).toBe(raw);
        expect(read(PROFILE_STORE_KEY)).toEqual(migrated);
        // An old tab can keep editing only its original key.
        save(LEGACY_PROFILE_STORE_KEY, sanitize_old_store(migrated));
        expect(initialize_profile_store()).toEqual(migrated);
        expect(window.localStorage.getItem(PROFILE_STORE_BACKUP_KEY)).toBe(raw);
    });

    it("does not overwrite an existing backup or new store, including empty progress", () => {
        save(LEGACY_PROFILE_STORE_KEY, old_store());
        window.localStorage.setItem(PROFILE_STORE_BACKUP_KEY, "original backup");
        const empty = sanitize_profile_store({ profiles: [{ name: "New", data: {} }] });
        save(PROFILE_STORE_KEY, empty);
        expect(initialize_profile_store()).toEqual(empty);
        expect(window.localStorage.getItem(PROFILE_STORE_BACKUP_KEY)).toBe("original backup");
        window.localStorage.removeItem(PROFILE_STORE_KEY);
        initialize_profile_store();
        expect(window.localStorage.getItem(PROFILE_STORE_BACKUP_KEY)).toBe("original backup");
    });

    it("does not re-import old data when an existing new store is malformed", () => {
        save(LEGACY_PROFILE_STORE_KEY, old_store());
        window.localStorage.setItem(PROFILE_STORE_KEY, "invalid json");
        expect(progress(initialize_profile_store())).toEqual([[]]);
        expect(window.localStorage.getItem(PROFILE_STORE_BACKUP_KEY)).toBeNull();
    });

    it("keeps old-tab storage events isolated and honors new-tab events", async () => {
        save(LEGACY_PROFILE_STORE_KEY, old_store());
        mount();
        expect(screen.getByTestId("progress").textContent).toBe("[291,339]");
        act(() =>
            storage_event(LEGACY_PROFILE_STORE_KEY, sanitize_old_store(read(PROFILE_STORE_KEY))),
        );
        expect(screen.getByTestId("progress").textContent).toBe("[291,339]");
        const updated = read(PROFILE_STORE_KEY);
        updated.profiles[1].data.missing.worked.dxcc.global = [339];
        act(() => storage_event(PROFILE_STORE_KEY, updated));
        expect(screen.getByTestId("progress").textContent).toBe("[339]");
        await userEvent.setup().click(screen.getByRole("button", { name: "Clear progress" }));
        expect(screen.getByTestId("progress").textContent).toBe("[]");
        cleanup();
        mount();
        expect(screen.getByTestId("progress").textContent).toBe("[]");
        expect(progress(read(PROFILE_STORE_KEY))).toEqual([[291, 339], []]);
        expect(read(PROFILE_STORE_BACKUP_KEY)).toEqual(old_store());
    });

    it("also migrates stores already using missing without reviving stale hunter progress", () => {
        const current = sanitize_profile_store(old_store());
        current.profiles[1].data.missing.worked.dxcc.global = [];
        current.profiles[1].data.hunter = old_store().profiles[1].data.hunter;
        save(LEGACY_PROFILE_STORE_KEY, current);
        expect(progress(initialize_profile_store())).toEqual([[291, 339], []]);
        expect(read(PROFILE_STORE_BACKUP_KEY)).toEqual(current);
    });

    it("retains individual legacy settings and creates empty progress on first use", () => {
        save("settings", { callsign: "N0CALL" });
        save("filters", { time_limit: 7200 });
        const store = initialize_profile_store();
        expect(store.profiles[0].data.settings.callsign).toBe("N0CALL");
        expect(store.profiles[0].data.filters.time_limit).toBe(7200);
        expect(progress(store)).toEqual([[]]);
        expect(read("settings")).toEqual({ callsign: "N0CALL" });
        expect(initialize_profile_store()).toEqual(store);
    });

    it("does not write a migrated store if its backup cannot be saved", () => {
        const raw = JSON.stringify(old_store());
        const storage = {
            getItem: key => (key === LEGACY_PROFILE_STORE_KEY ? raw : null),
            setItem: vi.fn(() => {
                throw new Error("Storage full");
            }),
        };
        expect(() => initialize_profile_store(storage)).toThrow("Storage full");
        expect(storage.setItem).toHaveBeenCalledExactlyOnceWith(PROFILE_STORE_BACKUP_KEY, raw);
    });

    it.each([PROFILE_STORE_BACKUP_KEY, PROFILE_STORE_KEY])(
        "shows a recoverable error when migration cannot write %s",
        async failed_key => {
            const original = JSON.stringify(old_store());
            window.localStorage.setItem(LEGACY_PROFILE_STORE_KEY, original);
            window.localStorage.setItem("unrelated", "keep me");
            const set_item = Storage.prototype.setItem;
            let blocked = true;
            const writes = vi
                .spyOn(Storage.prototype, "setItem")
                .mockImplementation(function (key, value) {
                    if (blocked && key === failed_key) {
                        throw new DOMException("Storage full", "QuotaExceededError");
                    }
                    return set_item.call(this, key, value);
                });

            mount();
            expect(screen.getByRole("alert").textContent).toContain(
                "Your saved profile data has not been deleted",
            );
            expect(screen.queryByTestId("progress")).toBeNull();
            expect(window.localStorage.getItem(LEGACY_PROFILE_STORE_KEY)).toBe(original);
            expect(window.localStorage.getItem("unrelated")).toBe("keep me");
            expect(window.localStorage.getItem(PROFILE_STORE_KEY)).toBeNull();
            // The persistent hook must not mount and repeat the failed allocation.
            expect(writes.mock.calls.filter(([key]) => key === failed_key)).toHaveLength(1);
            if (failed_key === PROFILE_STORE_BACKUP_KEY) {
                expect(window.localStorage.getItem(PROFILE_STORE_BACKUP_KEY)).toBeNull();
                expect(writes.mock.calls.some(([key]) => key === PROFILE_STORE_KEY)).toBe(false);
            } else {
                expect(window.localStorage.getItem(PROFILE_STORE_BACKUP_KEY)).toBe(original);
            }

            const user = userEvent.setup();
            await user.click(screen.getByRole("button", { name: "Retry" }));
            expect(screen.queryByTestId("progress")).toBeNull();
            expect(screen.getByRole("alert")).toBeTruthy();
            blocked = false;
            await user.click(screen.getByRole("button", { name: "Retry" }));
            expect(screen.queryByRole("alert")).toBeNull();
            expect(screen.getByTestId("progress").textContent).toBe("[291,339]");
            expect(progress(read(PROFILE_STORE_KEY))).toEqual([
                [291, 339],
                [291, 339],
            ]);
            expect(window.localStorage.getItem(PROFILE_STORE_BACKUP_KEY)).toBe(original);
            expect(window.localStorage.getItem(LEGACY_PROFILE_STORE_KEY)).toBe(original);
            expect(window.localStorage.getItem("unrelated")).toBe("keep me");
        },
    );

    it("initializes migration only once under StrictMode", () => {
        const original = JSON.stringify(old_store());
        window.localStorage.setItem(LEGACY_PROFILE_STORE_KEY, original);
        const writes = vi.spyOn(Storage.prototype, "setItem");
        render(
            <StrictMode>
                <MemoryRouter>
                    <ProfilesProvider>
                        <ProgressHarness />
                    </ProfilesProvider>
                </MemoryRouter>
            </StrictMode>,
        );
        expect(screen.getByTestId("progress").textContent).toBe("[291,339]");
        expect(writes.mock.calls.filter(([key]) => key === PROFILE_STORE_BACKUP_KEY)).toHaveLength(
            1,
        );
        expect(writes.mock.calls.filter(([key]) => key === PROFILE_STORE_KEY)).toHaveLength(1);
        expect(window.localStorage.getItem(LEGACY_PROFILE_STORE_KEY)).toBe(original);
    });

    it("keeps legacy imports and current export format working", () => {
        const imported = sanitize_imported_profile(old_store());
        expect(imported.name).toBe("Portable");
        expect(imported.data.missing.worked.dxcc.global).toEqual([291, 339]);
        const exported = create_profile_export(imported);
        expect(exported.version).toBe(1);
        expect(exported.data).not.toHaveProperty("hunter");
        expect(sanitize_imported_profile(exported)).toEqual(imported);
    });
});
