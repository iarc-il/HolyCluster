import { install_build_update_check } from "@/module_load_recovery.js";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ToastContainer, toast } from "react-toastify";

export default function BuildUpdate() {
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
        return install_build_update_check({
            entry: document.querySelector('meta[name="ui-entry"]')?.content,
            on_update: () =>
                toast.info(
                    <div>
                        A new version is available.{" "}
                        <button type="button" onClick={() => window.location.reload()}>
                            Reload to update
                        </button>
                    </div>,
                    {
                        toastId: "ui-build-update",
                        containerId: "ui-build-update",
                        autoClose: false,
                        closeButton: false,
                        closeOnClick: false,
                        draggable: false,
                    },
                ),
        });
    }, []);
    return createPortal(
        <ToastContainer containerId="ui-build-update" position="top-right" />,
        container,
    );
}
