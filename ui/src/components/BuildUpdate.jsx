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
        const mismatch = navigation_outcome?.event === "target_mismatch";
        if (!stale_recovery && !mismatch) return;
        const manual = mismatch || stale_recovery?.status === "manual";
        const blocked = stale_recovery?.status === "blocked";
        const checking = stale_recovery?.status === "checking";
        let message =
            "A module failed to load. HolyCluster will refresh when this tab is hidden or after one hour without activity. ";
        if (stale_recovery?.status === "manual") {
            message = "Part of the UI could not be loaded. ";
        } else if (manual) message = "The update could not be loaded automatically. ";
        else if (blocked) message = "The update is waiting for the current operation to finish. ";
        else if (checking) message = "A module failed to load. Checking for an update. ";
        const content = (
            <div>
                {message}
                {!checking && (
                    <button type="button" onClick={manual_reload}>
                        {manual ? "Reload manually" : "Reload now"}
                    </button>
                )}
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
