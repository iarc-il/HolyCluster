import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";

function Popup({ anchor_ref, children }) {
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const popupRef = useRef(null);

    useEffect(() => {
        const anchor = anchor_ref.current;
        if (!anchor) {
            return;
        }

        const rect = anchor.getBoundingClientRect();
        const popup_width = popupRef.current?.offsetWidth || 0;
        const popup_height = popupRef.current?.offsetHeight || 0;

        setPosition({
            top: rect.top + window.scrollY - popup_height,
            left: rect.left + rect.width / 2 + window.scrollX - popup_width / 2,
        });
    }, [anchor_ref]);

    return createPortal(
        <div
            ref={popupRef}
            className="absolute z-[80] p-0"
            style={{ top: position.top, left: position.left }}
        >
            {children}
        </div>,
        document.body,
    );
}

export default Popup;
