import { install_module_load_recovery } from "@/module_load_recovery.js";
import { afterEach, expect, it, vi } from "vitest";

let remove;
afterEach(() => {
    remove?.();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

function start(entry = "/assets/new.js", response = {}) {
    const notify = vi.fn();
    const reload = vi.fn();
    vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
            ok: true,
            headers: new Headers({ "content-type": "text/html" }),
            text: async () =>
                `<meta name="ui-entry" content="${entry}"><script type="module" src="${entry}"></script>`,
            ...response,
        }),
    );
    remove = install_module_load_recovery({ entry: "/assets/old.js", notify, reload });
    return { notify, reload };
}

it("notifies once without automatic reload across interval and visibility checks", async () => {
    vi.useFakeTimers();
    const { notify, reload } = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(notify).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300000 * 2);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    notify.mock.calls[0][0]();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ cache: "no-store", redirect: "error" }),
    );
});

it("ignores the loaded build", async () => {
    const { notify } = start("/assets/old.js");
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(notify).not.toHaveBeenCalled();
});

it("ignores failed requests and retries without overlapping requests", async () => {
    vi.useFakeTimers();
    const { notify } = start();
    await vi.advanceTimersByTimeAsync(0);
    remove();
    notify.mockClear();
    fetch.mockImplementation(
        (_url, { signal }) =>
            new Promise((_resolve, reject) => {
                signal.addEventListener("abort", () => reject(new Error("offline")));
            }),
    );
    remove = install_module_load_recovery({ entry: "/assets/old.js", notify });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5001);
    expect(notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300000);
    expect(fetch).toHaveBeenCalledTimes(3);
});

it("checks only after a hidden tab becomes visible and waits for network access", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { onLine: false });
    const { notify } = start();
    expect(fetch).not.toHaveBeenCalled();
    navigator.onLine = true;
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(300000);
    expect(fetch).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
});

it.each([
    { redirected: true },
    { ok: false },
    { headers: new Headers({ "content-type": "text/plain" }) },
    {
        text: async () =>
            '<meta name="ui-entry" content="/assets/new.js"><script type="module" src="/assets/other.js"></script>',
    },
])("ignores invalid HTML responses: %o", async response => {
    const { notify } = start("/assets/new.js", response);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(notify).not.toHaveBeenCalled();
});

it.each(["https://other.test/assets/new.js", "/assets/../new.js", "/assets/new.js?x=1"])(
    "rejects unsafe entry %s",
    async entry => {
        const { notify } = start(entry);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(notify).not.toHaveBeenCalled();
    },
);
