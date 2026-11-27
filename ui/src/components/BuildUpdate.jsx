import { useUiRefresh } from "@/hooks/useUiRefresh.jsx";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ToastContainer, toast } from "react-toastify";

export default function BuildUpdate() {
    const { manual_reload, navigation_outcome, stale_recovery } = useUiRefresh();
    const notification_shown_ref = useRef(false);
    const [container] = useState(() => document.createElement("div"));
    useEffect(() => {
        function move_container() {
            // Move the host, not the portal, to keep the notification during fullscreen changes.
            (document.fullscreenElement ?? document.body).append(container);
        }
        move_container();
        document.addEventListener("fullscreenchange", move_container);
        return () => {
            document.removeEventListener("fullscreenchange", move_container);
            container.remove();
        };
    }, [container]);
    useEffect(() => {
        const recovery_failed = stale_recovery?.status === "manual";
        const reload_failed = navigation_outcome?.event === "target_mismatch";
        if (!recovery_failed && !reload_failed) return;
        const content = (
            <div>
                {"Part of the UI could not be loaded. "}
                <button type="button" onClick={manual_reload}>
                    Reload
                </button>
            </div>
        );
        if (notification_shown_ref.current) {
            toast.update("ui-build-update", {
                containerId: "ui-build-update",
                render: content,
            });
        } else {
            notification_shown_ref.current = true;
            toast.info(content, {
                toastId: "ui-build-update",
                containerId: "ui-build-update",
                autoClose: false,
                closeButton: false,
                closeOnClick: false,
                draggable: false,
            });
        }
    }, [manual_reload, navigation_outcome, stale_recovery]);
    return createPortal(
        <ToastContainer containerId="ui-build-update" position="top-right" />,
        container,
    );
}
