import { afterEach, describe, expect, it, vi } from "vitest";

import { install_module_load_recovery } from "@/module_load_recovery.js";

afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
});

function preload_error() {
    const event = new Event("vite:preloadError");
    event.payload = new TypeError("Importing a module script failed.");
    return event;
}

describe("module load recovery", () => {
    it("does not reload twice into the same target build", async () => {
        const events = new EventTarget();
        const reload = vi.fn();
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                headers: new Headers({ "content-type": "text/html" }),
                text: async () =>
                    '<meta name="ui-entry" content="/assets/new.js"><script type="module" src="/assets/new.js"></script>',
            }),
        );
        const remove = install_module_load_recovery({ events, entry: "/assets/old.js", reload });
        events.dispatchEvent(preload_error());
        await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        remove();
        install_module_load_recovery({ events, entry: "/assets/old.js", reload });
        events.dispatchEvent(preload_error());
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        expect(reload).toHaveBeenCalledTimes(1);
    });

    it("does not handle unrelated runtime errors", () => {
        const events = new EventTarget();
        const reload = vi.fn();
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);
        install_module_load_recovery({ events, entry: "/assets/current.js", reload });
        events.dispatchEvent(new Event("error"));
        const runtime_error = preload_error();
        runtime_error.payload = new TypeError("e.jsx is not a function");
        events.dispatchEvent(runtime_error);
        expect(fetch).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
    });
});
