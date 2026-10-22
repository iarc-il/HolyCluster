export function install_module_load_recovery({
    events = window,
    entry,
    reload = () => window.location.reload(),
    notify,
} = {}) {
    if (!asset_url(entry)) return () => {};
    let pending = false;
    let notified = false;
    let stopped = false;
    let active_controller;

    function asset_url(value) {
        try {
            const url = new URL(value, window.location.origin);
            return (
                url.origin === window.location.origin &&
                /^\/assets\/[A-Za-z0-9_-]+\.js$/.test(url.pathname) &&
                !url.search &&
                !url.hash &&
                (value === url.pathname || value === url.href)
            );
        } catch {
            return false;
        }
    }

    async function recover(event) {
        const script = event.target;
        const initial_failure =
            event.type === "error" &&
            script instanceof HTMLScriptElement &&
            script.type === "module" &&
            asset_url(script.src);
        const message = event.payload?.message;
        const import_failure =
            event.type === "vite:preloadError" &&
            typeof message === "string" &&
            /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
                message,
            );
        if (!notify && !initial_failure && !import_failure) return;
        if (pending || stopped || notified || !navigator.onLine) return;
        pending = true;
        const marker = "holycluster_module_reload_target";
        const controller = new AbortController();
        active_controller = controller;
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            // Storage must work before a navigation can be safe.
            const storage = notify ? null : window.sessionStorage;
            storage?.setItem(`${marker}_probe`, "1");
            storage?.removeItem(`${marker}_probe`);
            const response = await fetch(window.location.href, {
                cache: "no-store",
                credentials: "same-origin",
                redirect: "error",
                signal: controller.signal,
                headers: { Accept: "text/html" },
            });
            if (
                response.redirected ||
                !response.ok ||
                !response.headers
                    .get("content-type")
                    ?.split(";")[0]
                    .trim()
                    .toLowerCase()
                    .match(/^text\/html$/)
            )
                return;
            const document = new DOMParser().parseFromString(await response.text(), "text/html");
            const next = document.querySelector('meta[name="ui-entry"]')?.content;
            if (
                stopped ||
                !next ||
                !asset_url(next) ||
                next === entry ||
                storage?.getItem(marker) === next
            )
                return;
            const module = document.querySelector('script[type="module"][src]');
            if (module?.getAttribute("src") !== next) return;
            if (notify) {
                if (!notified) {
                    notified = true;
                    clearInterval(interval);
                    document.removeEventListener("visibilitychange", visible);
                    notify(reload);
                }
            } else {
                storage.setItem(marker, next);
                reload();
            }
        } catch {
            // An outage is not evidence that a new build exists.
        } finally {
            clearTimeout(timeout);
            pending = false;
        }
    }

    function visible() {
        if (document.visibilityState === "visible") recover({});
    }
    // Retained assets support 7 days or the newest 4 releases, not permanent clients.
    const interval = notify ? setInterval(visible, 5 * 60 * 1000) : null;
    if (notify) {
        document.addEventListener("visibilitychange", visible);
        recover({});
    } else {
        events.addEventListener("error", recover, true);
        events.addEventListener("vite:preloadError", recover);
    }
    return () => {
        stopped = true;
        active_controller?.abort();
        clearInterval(interval);
        document.removeEventListener("visibilitychange", visible);
        events.removeEventListener("error", recover, true);
        events.removeEventListener("vite:preloadError", recover);
    };
}
