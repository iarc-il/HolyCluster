import { describe, expect, it, vi } from "vitest";

import { install_module_load_recovery } from "@/module_load_recovery.js";

function storage() {
    const values = new Map();
    return {
        getItem: key => values.get(key) ?? null,
        removeItem: key => values.delete(key),
        setItem: (key, value) => values.set(key, value),
    };
}

function preload_error() {
    return new Event("vite:preloadError", { cancelable: true });
}

describe("module load recovery", () => {
    it("reloads once for a failed release", () => {
        const events = new EventTarget();
        const session = storage();
        const reload = vi.fn();
        install_module_load_recovery({ events, release: "release-a", reload, storage: session });

        const first = preload_error();
        events.dispatchEvent(first);
        const second = preload_error();
        events.dispatchEvent(second);

        expect(first.defaultPrevented).toBe(true);
        expect(second.defaultPrevented).toBe(false);
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("allows a new release to recover again", () => {
        const events = new EventTarget();
        const session = storage();
        const reload = vi.fn();
        const remove_first = install_module_load_recovery({
            events,
            release: "release-a",
            reload,
            storage: session,
        });
        events.dispatchEvent(preload_error());
        remove_first();

        install_module_load_recovery({
            events,
            release: "release-b",
            reload,
            storage: session,
        });
        const next_release = preload_error();
        events.dispatchEvent(next_release);

        expect(next_release.defaultPrevented).toBe(true);
        expect(reload).toHaveBeenCalledTimes(2);
    });
});
