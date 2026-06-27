import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import Button from "@/components/ui/Button.jsx";
import { useColors } from "@/hooks/useColors";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

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
    apply_disabled = false,
    modal_style = null,
    children,
}) {
    const [show_modal, set_show_modal] = useState(false);
    const { colors } = useColors();
    const trigger_ref = useRef(null);
    const modal_ref = useRef(null);
    const previously_focused_ref = useRef(null);

    function close() {
        set_show_modal(false);
        previously_focused_ref.current?.focus();
    }

    const on_keydown = useCallback(
        event => {
            if (!show_modal) return;

            if (event.key === "Escape") {
                if (on_cancel != null) {
                    on_cancel();
                }
                close();
            } else if (event.key === "Enter") {
                if (on_apply && !apply_disabled) {
                    event.preventDefault();
                    set_show_modal(!on_apply());
                }
            }
        },
        [show_modal, on_apply, apply_disabled, on_cancel],
    );

    useEffect(() => {
        if (external_open) {
            if (on_open != null) on_open();
            set_show_modal(true);
        }
    }, [external_open]);

    useEffect(() => {
        if (external_close === false) {
            set_show_modal(false);
        }
    }, [external_close]);

    useEffect(() => {
        if (show_modal) {
            previously_focused_ref.current = document.activeElement;
            document.addEventListener("keydown", on_keydown);
            return () => {
                document.removeEventListener("keydown", on_keydown);
            };
        }
    }, [show_modal, on_keydown]);

    useEffect(() => {
        if (!show_modal) return;
        const modal = modal_ref.current;
        if (!modal) return;

        const focusable = modal.querySelectorAll(FOCUSABLE);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        first?.focus();

        function trap(event) {
            if (event.key !== "Tab") return;
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        }
        modal.addEventListener("keydown", trap);
        return () => modal.removeEventListener("keydown", trap);
    }, [show_modal]);

    return (
        <>
            <div
                ref={trigger_ref}
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
                        ref={modal_ref}
                        role="dialog"
                        aria-modal={true}
                        className="flex pt-24 fixed inset-0 z-[60] outline-none focus:outline-none overflow-y-auto"
                        style={{ color: colors.theme.text }}
                    >
                        <div className="relative min-w-80 my-6 mx-auto pb-6">
                            <div className="absolute top-0 right-0 p-2 cursor-pointer z-[70]">
                                <svg
                                    width="24"
                                    height="24"
                                    viewBox="0 0 1024 1024"
                                    onClick={() => {
                                        if (on_cancel != null) {
                                            on_cancel();
                                        }
                                        close();
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
                                    ...modal_style,
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
                                                    close();
                                                }}
                                            >
                                                {cancel_text}
                                            </Button>
                                        ) : null}
                                        {on_apply != null ? (
                                            <Button
                                                color="blue"
                                                disabled={apply_disabled}
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
