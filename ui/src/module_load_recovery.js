export async function detect_ui_build({ entry, signal } = {}) {
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

    if (!asset_url(entry)) return null;
    const response = await fetch(window.location.href, {
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal,
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
        return null;

    const next_document = new DOMParser().parseFromString(await response.text(), "text/html");
    const target_entry = next_document.querySelector('meta[name="ui-entry"]')?.content;
    if (!target_entry || !asset_url(target_entry) || target_entry === entry) return null;
    const module = next_document.querySelector('script[type="module"][src]');
    if (module?.getAttribute("src") !== target_entry) return null;
    return { current_entry: entry, target_entry };
}

export function install_module_load_recovery({
    events = window,
    entry,
    reload = () => window.location.reload(),
    check = detect_ui_build,
} = {}) {
    let pending = false;
    let stopped = false;
    let active_controller;

    function asset_url(value) {
        try {
            const url = new URL(value, window.location.origin);
            return (
                url.origin === window.location.origin &&
                /^\/assets\/[A-Za-z0-9_-]+\.js$/.test(url.pathname) &&
                !url.search &&
                !url.hash
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
        if (pending || stopped || !navigator.onLine) return;
        pending = true;
        const marker = "holycluster_module_reload_target";
        const controller = new AbortController();
        active_controller = controller;
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            // Storage must work before a navigation can be safe.
            const storage = window.sessionStorage;
            storage.setItem(`${marker}_probe`, "1");
            storage.removeItem(`${marker}_probe`);
            const update = await check({ entry, signal: controller.signal });
            if (stopped || !update || storage.getItem(marker) === update.target_entry) return;
            storage.setItem(marker, update.target_entry);
            events.dispatchEvent(new Event("holycluster:ui-navigation"));
            reload();
        } catch {
            // An outage is not evidence that a new build exists.
        } finally {
            clearTimeout(timeout);
            pending = false;
        }
    }

    events.addEventListener("error", recover, true);
    events.addEventListener("vite:preloadError", recover);
    return () => {
        stopped = true;
        active_controller?.abort();
        events.removeEventListener("error", recover, true);
        events.removeEventListener("vite:preloadError", recover);
    };
}
