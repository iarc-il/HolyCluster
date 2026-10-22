export function install_module_load_recovery({
    events = window,
    entry,
    reload = () => window.location.reload(),
} = {}) {
    if (!entry) return () => {};
    let pending = false;

    function asset_url(value) {
        try {
            const url = new URL(value, window.location.origin);
            return (
                url.origin === window.location.origin && /^\/assets\/[^/]+\.js$/.test(url.pathname)
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
        if (!initial_failure && !import_failure) return;
        if (pending || !navigator.onLine) return;
        pending = true;
        const marker = "holycluster_module_reload_target";
        try {
            // Storage must work before a navigation can be safe.
            const storage = window.sessionStorage;
            storage.setItem(`${marker}_probe`, "1");
            storage.removeItem(`${marker}_probe`);
            const response = await fetch(window.location.href, {
                cache: "no-store",
                credentials: "same-origin",
                redirect: "error",
                signal: AbortSignal.timeout(5000),
                headers: { Accept: "text/html" },
            });
            if (!response.ok || !response.headers.get("content-type")?.includes("text/html"))
                return;
            const document = new DOMParser().parseFromString(await response.text(), "text/html");
            const next = document.querySelector('meta[name="ui-entry"]')?.content;
            if (!next || !asset_url(next) || next === entry || storage.getItem(marker) === next)
                return;
            const module = document.querySelector('script[type="module"][src]');
            if (module?.getAttribute("src") !== next) return;
            storage.setItem(marker, next);
            reload();
        } catch {
            // An outage is not evidence that a new build exists.
        } finally {
            pending = false;
        }
    }

    events.addEventListener("error", recover, true);
    events.addEventListener("vite:preloadError", recover);
    return () => {
        events.removeEventListener("error", recover, true);
        events.removeEventListener("vite:preloadError", recover);
    };
}
