import { afterEach, describe, expect, it, vi } from "vitest";

import { install_module_load_recovery } from "@/module_load_recovery.js";

afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
});

function entry_script(src = "/assets/old.js") {
    const script = document.createElement("script");
    script.type = "module";
    script.src = src;
    return script;
}

describe("module load recovery", () => {
    it("makes only one automatic attempt for the failed initial entry", async () => {
        const events = entry_script();
        const reload = vi.fn();
        const manual = vi.fn();
        const check = vi.fn().mockResolvedValue({
            current_entry: "/assets/old.js",
            target_entry: "/assets/new.js",
        });
        const navigating = vi.fn();
        events.addEventListener("holycluster:ui-navigation", navigating);
        const remove = install_module_load_recovery({
            events,
            entry: "/assets/old.js",
            reload,
            check,
            manual,
        });

        events.dispatchEvent(new Event("error", { cancelable: true }));
        await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        expect(navigating).toHaveBeenCalledTimes(1);
        expect(JSON.parse(sessionStorage.getItem("holycluster_ui_navigation"))).toEqual({
            source_entry: "/assets/old.js",
            target_entry: "/assets/new.js",
        });
        remove();

        install_module_load_recovery({
            events,
            entry: "/assets/old.js",
            reload,
            check,
            manual,
        });
        events.dispatchEvent(new Event("error", { cancelable: true }));
        await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(2));
        expect(reload).toHaveBeenCalledTimes(1);
        expect(manual).toHaveBeenCalledTimes(1);
    });

    it("shows manual recovery when a changed entry cannot be confirmed", async () => {
        const events = entry_script();
        const reload = vi.fn();
        const manual = vi.fn();
        install_module_load_recovery({
            events,
            entry: "/assets/old.js",
            reload,
            check: vi.fn().mockResolvedValue(null),
            manual,
        });

        events.dispatchEvent(new Event("error", { cancelable: true }));
        await vi.waitFor(() => expect(manual).toHaveBeenCalledTimes(1));
        expect(reload).not.toHaveBeenCalled();
    });

    it("ignores other module and dynamic import failures", async () => {
        const events = entry_script("/assets/lazy.js");
        const reload = vi.fn();
        const check = vi.fn();
        install_module_load_recovery({
            events,
            entry: "/assets/old.js",
            reload,
            check,
        });

        events.dispatchEvent(new Event("error", { cancelable: true }));
        const preload = new Event("vite:preloadError", { cancelable: true });
        preload.payload = new TypeError("Importing a module script failed.");
        events.dispatchEvent(preload);
        await Promise.resolve();
        expect(check).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
        expect(preload.defaultPrevented).toBe(false);
    });
});
