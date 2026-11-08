import Button from "@/components/ui/Button.jsx";
import { useColors } from "@/hooks/useColors";
import { useEffect, useState } from "react";
import { toast } from "react-toastify";

function is_standalone() {
    return (
        window.matchMedia?.("(display-mode: standalone)").matches ||
        window.navigator.standalone === true
    );
}

function is_mobile() {
    return (
        window.navigator.userAgentData?.mobile === true ||
        /Android|iPhone|iPad|iPod/i.test(window.navigator.userAgent)
    );
}

function installation_help() {
    if (/iPhone|iPad|iPod/i.test(window.navigator.userAgent)) {
        return "Use Share, then Add to Home Screen.";
    }
    return "Open the browser menu and choose Install or Add to Home screen.";
}

export default function InstallApp() {
    const { colors } = useColors();
    const [install_prompt, set_install_prompt] = useState(null);
    const [installed, set_installed] = useState(is_standalone);
    const [available, set_available] = useState(() => !is_standalone() && is_mobile());

    useEffect(() => {
        const display_mode = window.matchMedia?.("(display-mode: standalone)");

        function update_display_mode() {
            const next_installed = is_standalone();
            set_installed(next_installed);
            if (next_installed) set_available(false);
        }

        function offer_install(event) {
            event.preventDefault();
            set_install_prompt(event);
            set_available(true);
        }

        function installation_finished() {
            set_install_prompt(null);
            set_installed(true);
            set_available(false);
        }

        window.addEventListener("beforeinstallprompt", offer_install);
        window.addEventListener("appinstalled", installation_finished);
        display_mode?.addEventListener?.("change", update_display_mode);
        return () => {
            window.removeEventListener("beforeinstallprompt", offer_install);
            window.removeEventListener("appinstalled", installation_finished);
            display_mode?.removeEventListener?.("change", update_display_mode);
        };
    }, []);

    if (installed || !available) return null;

    async function install() {
        if (!install_prompt) {
            toast.info(installation_help(), { toastId: "install-holycluster" });
            return;
        }

        set_available(false);
        try {
            await install_prompt.prompt();
            await install_prompt.userChoice;
        } catch {
            toast.info(installation_help(), { toastId: "install-holycluster" });
        } finally {
            set_install_prompt(null);
        }
    }

    return (
        <Button
            color="utility"
            className="min-h-11 min-w-11 p-1"
            type="button"
            aria-label="Install HolyCluster"
            title="Install HolyCluster"
            data-tour="top-bar-install-app"
            on_click={install}
        >
            <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke={colors.buttons.utility}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <path d="M12 3v12" />
                <path d="m8 11 4 4 4-4" />
                <path d="M5 19h14" />
            </svg>
        </Button>
    );
}
