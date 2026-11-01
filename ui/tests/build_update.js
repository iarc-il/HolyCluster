import { detect_ui_build } from "@/module_load_recovery.js";
import { afterEach, expect, it, vi } from "vitest";

function response(entry = "/assets/new.js", values = {}) {
    return {
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
        text: async () =>
            `<meta name="ui-entry" content="${entry}"><script type="module" src="${entry}"></script>`,
        ...values,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

it("reports the running and target entries for a changed build", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));

    await expect(detect_ui_build({ entry: "/assets/old.js" })).resolves.toEqual({
        current_entry: "/assets/old.js",
        target_entry: "/assets/new.js",
    });
    expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ cache: "no-store", redirect: "error" }),
    );
});

it("ignores the loaded build", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("/assets/old.js")));
    await expect(detect_ui_build({ entry: "/assets/old.js" })).resolves.toBeNull();
});

it.each([
    { redirected: true },
    { ok: false },
    { headers: new Headers({ "content-type": "text/plain" }) },
    {
        text: async () =>
            '<meta name="ui-entry" content="/assets/new.js"><script type="module" src="/assets/other.js"></script>',
    },
])("ignores invalid HTML responses: %o", async values => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("/assets/new.js", values)));
    await expect(detect_ui_build({ entry: "/assets/old.js" })).resolves.toBeNull();
});

it.each(["https://other.test/assets/new.js", "/assets/../new.js", "/assets/new.js?x=1"])(
    "rejects unsafe entry %s",
    async entry => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(entry)));
        await expect(detect_ui_build({ entry: "/assets/old.js" })).resolves.toBeNull();
    },
);
