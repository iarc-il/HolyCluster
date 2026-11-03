import { afterEach, describe, expect, it, vi } from "vitest";

import { detect_ui_build, install_module_load_recovery } from "@/module_load_recovery.js";

afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
});

function response({
    status = 200,
    ok = true,
    redirected = false,
    content_type = "text/html; charset=utf-8",
    html = '<meta name="ui-entry" content="/assets/new.js"><script type="module" src="/assets/new.js"></script>',
    text = async () => html,
} = {}) {
    return {
        status,
        ok,
        redirected,
        headers: new Headers({ "content-type": content_type }),
        text,
    };
}

function entry_script(src = "/assets/old.js") {
    const script = document.createElement("script");
    script.type = "module";
    script.src = src;
    return script;
}

describe("UI build detection diagnostics", () => {
    it.each([
        [response({ status: 503, ok: false }), null, "http_error", "response", null],
        [response({ content_type: "application/json" }), null, "not_html", "response", null],
        [response({ html: "<html></html>" }), null, "missing_entry", "html_parsed", null],
        [
            response({ html: '<meta name="ui-entry" content="/private.js">' }),
            null,
            "invalid_entry",
            "html_parsed",
            null,
        ],
        [
            response({ html: '<meta name="ui-entry" content="/assets/old.js">' }),
            null,
            "same_entry",
            "html_parsed",
            "/assets/old.js",
        ],
        [
            response({ html: '<meta name="ui-entry" content="/assets/new.js">' }),
            null,
            "entry_mismatch",
            "html_parsed",
            "/assets/new.js",
        ],
        [
            response(),
            { current_entry: "/assets/old.js", target_entry: "/assets/new.js" },
            "new_build",
            "html_parsed",
            "/assets/new.js",
        ],
    ])(
        "reports bounded probe result %#",
        async (fetch_response, expected, reason, probe_outcome, probed_entry) => {
            const fetch = vi.fn().mockResolvedValue(fetch_response);
            vi.stubGlobal("fetch", fetch);
            const diagnostics = [];
            await expect(
                detect_ui_build({
                    entry: "/assets/old.js",
                    on_diagnostic: value => diagnostics.push(value),
                }),
            ).resolves.toEqual(expected);
            expect(fetch).toHaveBeenCalledExactlyOnceWith(
                window.location.href,
                expect.objectContaining({
                    cache: "no-store",
                    credentials: "same-origin",
                    redirect: "error",
                    headers: { Accept: "text/html" },
                }),
            );
            expect(diagnostics).toEqual([
                expect.objectContaining({
                    page_entry: "/assets/old.js",
                    probed_entry,
                    probe_outcome,
                    probe_status: fetch_response.status,
                    probe_content_type: fetch_response.headers.get("content-type").split(";")[0],
                    probe_reason: reason,
                }),
            ]);
            expect(JSON.stringify(diagnostics)).not.toContain("private");
        },
    );

    it.each([
        [new TypeError("private request failure"), false, "request_failed"],
        [new DOMException("private abort", "AbortError"), true, "aborted"],
    ])(
        "reports request failures without changing the thrown value",
        async (error, aborted, reason) => {
            vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
            const controller = new AbortController();
            if (aborted) controller.abort();
            const diagnostics = [];
            await expect(
                detect_ui_build({
                    entry: "/assets/old.js",
                    signal: controller.signal,
                    on_diagnostic: value => diagnostics.push(value),
                }),
            ).rejects.toBe(error);
            expect(diagnostics).toEqual([
                expect.objectContaining({
                    probe_outcome: reason,
                    probe_reason: reason,
                    probe_status: null,
                    probe_content_type: null,
                }),
            ]);
            expect(JSON.stringify(diagnostics)).not.toContain("private");
        },
    );

    it("reports body failures without changing the thrown value", async () => {
        const error = new Error("private body failure");
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(response({ text: async () => Promise.reject(error) })),
        );
        const diagnostics = [];
        await expect(
            detect_ui_build({
                entry: "/assets/old.js",
                on_diagnostic: value => diagnostics.push(value),
            }),
        ).rejects.toBe(error);
        expect(diagnostics).toEqual([
            expect.objectContaining({
                probe_outcome: "response",
                probe_reason: "body_failed",
            }),
        ]);
    });

    it("ignores a throwing diagnostic observer", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
        await expect(
            detect_ui_build({
                entry: "/assets/old.js",
                on_diagnostic: () => {
                    throw new Error("telemetry failed");
                },
            }),
        ).resolves.toEqual({
            current_entry: "/assets/old.js",
            target_entry: "/assets/new.js",
        });
    });
});

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
