import { useLayoutEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";

function Popup({
    anchor_ref,
    children,
    keep_in_view = false,
    viewport_padding = 8,
    vertical_offset = 0,
}) {
    const [position, setPosition] = useState(null);
    const popupRef = useRef(null);

    useLayoutEffect(() => {
        const updatePosition = () => {
            const anchor = anchor_ref.current;
            if (!anchor) {
                return;
            }

            const rect = anchor.getBoundingClientRect();
            const popup = popupRef.current;
            const popup_width = popup?.offsetWidth || 0;
            let left = rect.left + rect.width / 2;

            if (keep_in_view && popup_width > 0) {
                const min_left = viewport_padding + popup_width / 2;
                const max_left = window.innerWidth - viewport_padding - popup_width / 2;
                left = Math.min(Math.max(left, min_left), max_left);
            }

            setPosition({
                top: rect.top + vertical_offset,
                left,
            });
        };

        updatePosition();
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);

        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [anchor_ref, children, keep_in_view, viewport_padding, vertical_offset]);

    return createPortal(
        <div
            ref={popupRef}
            className="fixed z-[80] p-0 pointer-events-none"
            style={{
                top: position?.top ?? -9999,
                left: position?.left ?? -9999,
                transform: "translate(-50%, -100%)",
                visibility: position ? "visible" : "hidden",
                width: "max-content",
                maxWidth: "min(90vw, 28rem)",
            }}
        >
            {children}
        </div>,
        document.body,
    );
}

export default Popup;
