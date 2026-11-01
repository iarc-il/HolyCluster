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
    manual = () => {
        const message = document.createElement("div");
        message.setAttribute("role", "alert");
        message.textContent = "HolyCluster could not load. ";
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Reload manually";
        button.addEventListener("click", () => window.location.reload());
        message.append(button);
        document.body.append(message);
    },
} = {}) {
    let pending = false;
    let stopped = false;
    let active_controller;

    async function recover(event) {
        const script = event.target;
        const expected = new URL(entry, window.location.origin).href;
        const initial_failure =
            event.type === "error" &&
            script instanceof HTMLScriptElement &&
            script.type === "module" &&
            script.src === expected;
        if (!initial_failure || pending || stopped) return;
        event.preventDefault();
        pending = true;
        const controller = new AbortController();
        active_controller = controller;
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            const storage = window.sessionStorage;
            storage.setItem("holycluster_ui_navigation_probe", "1");
            storage.removeItem("holycluster_ui_navigation_probe");
            const update = navigator.onLine
                ? await check({ entry, signal: controller.signal })
                : null;
            if (stopped) return;
            if (
                !update ||
                storage.getItem("holycluster_ui_last_auto_target") === update.target_entry
            ) {
                manual();
                return;
            }
            storage.setItem("holycluster_ui_last_auto_target", update.target_entry);
            storage.setItem(
                "holycluster_ui_navigation",
                JSON.stringify({
                    source_entry: update.current_entry,
                    target_entry: update.target_entry,
                }),
            );
            events.dispatchEvent(new Event("holycluster:ui-navigation"));
            reload();
        } catch {
            if (!stopped) manual();
        } finally {
            clearTimeout(timeout);
            pending = false;
        }
    }

    events.addEventListener("error", recover, true);
    return () => {
        stopped = true;
        active_controller?.abort();
        events.removeEventListener("error", recover, true);
    };
}
