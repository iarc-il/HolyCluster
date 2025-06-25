import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import Button from "@/components/Button.jsx";
import { useColors } from "../hooks/useColors";

function Modal({
    title = null,
    button,
    on_open = null,
    on_apply = null,
    on_cancel = null,
    apply_text = "Apply",
    cancel_text = "Cancel",
    external_open = null,
    external_close = null,
    children,
}) {
    const [show_modal, set_show_modal] = useState(false);
    const { colors } = useColors();

    function on_escape(event) {
        if (event.key == "Escape") {
            if (on_cancel != null) {
                on_cancel();
            }
            set_show_modal(false);
        }
    }

    useEffect(() => {
        if (external_open) {
            if (on_open != null) on_open();

            set_show_modal(true);
        }
    }, [external_open]);
    useEffect(() => {
        if (!external_close) {
            set_show_modal(false);
        }
    }, [external_close]);

    useEffect(() => {
        document.body.addEventListener("keydown", on_escape);
        return () => {
            document.body.removeEventListener("keydown", on_escape);
        };
    });

    return (
        <>
            <div
                className="cursor-pointer"
                onClick={() => {
                    if (on_open != null) {
                        on_open();
                    }
                    set_show_modal(true);
                }}
            >
                {button}
            </div>
            {show_modal &&
                createPortal(
                    <div
                        className="flex pt-24 fixed inset-0 z-[60] outline-none focus:outline-none"
                        style={{ color: colors.theme.text }}
                    >
                        <div className="relative min-w-80 my-6 mx-auto max-w-3xl">
                            <div className="absolute top-0 right-0 p-2 cursor-pointer z-[70]">
                                <svg
                                    width="24"
                                    height="24"
                                    viewBox="0 0 1024 1024"
                                    onClick={() => {
                                        if (on_cancel != null) {
                                            on_cancel();
                                        }
                                        set_show_modal(false);
                                    }}
                                >
                                    <path
                                        fill="#FF0000"
                                        d="M195.2 195.2a64 64 0 0 1 90.496 0L512 421.504 738.304 195.2a64 64 0 0 1 90.496 90.496L602.496 512 828.8 738.304a64 64 0 0 1-90.496 90.496L512 602.496 285.696 828.8a64 64 0 0 1-90.496-90.496L421.504 512 195.2 285.696a64 64 0 0 1 0-90.496z"
                                    />
                                </svg>
                            </div>
                            <div
                                className="rounded-lg shadow-xl relative flex flex-col w-full outline-none focus:outline-none border"
                                style={{
                                    backgroundColor: colors.theme.modals,
                                    borderColor: colors.theme.borders,
                                }}
                            >
                                {title != null ? (
                                    <div className="flex items-start items-center p-4 border-b border-solid border-gray-300 rounded-t gap-3">
                                        {title}
                                    </div>
                                ) : null}
                                <div>{children}</div>
                                {on_cancel != null && on_apply != null ? (
                                    <div className="flex items-center justify-around p-3 border-t border-solid border-blueGray-200 rounded-b">
                                        {on_cancel != null ? (
                                            <Button
                                                color="red"
                                                on_click={() => {
                                                    on_cancel();
                                                    set_show_modal(false);
                                                }}
                                            >
                                                {cancel_text}
                                            </Button>
                                        ) : null}
                                        {on_apply != null ? (
                                            <Button
                                                color="blue"
                                                on_click={() => set_show_modal(!on_apply())}
                                            >
                                                {apply_text}
                                            </Button>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
}

export default Modal;
