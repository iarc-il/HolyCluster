import { cloneElement, useId, useRef, useState } from "react";

import { useColors } from "@/hooks/useColors";

import Popup from "./Popup.jsx";

function Tooltip({ children, content, className = "text-xs" }) {
    const { colors } = useColors();
    const anchor_ref = useRef(null);
    const tooltip_id = useId();
    const [is_visible, set_is_visible] = useState(false);

    return (
        <span
            ref={anchor_ref}
            className="inline-flex"
            onMouseEnter={() => set_is_visible(true)}
            onMouseLeave={() => set_is_visible(false)}
            onFocus={() => set_is_visible(true)}
            onBlur={() => set_is_visible(false)}
        >
            {cloneElement(children, {
                "aria-describedby": is_visible ? tooltip_id : undefined,
            })}
            {is_visible && (
                <Popup anchor_ref={anchor_ref}>
                    <span
                        id={tooltip_id}
                        role="tooltip"
                        className={`py-1 px-2 rounded shadow-lg ${className}`}
                        style={{
                            color: colors.theme.text,
                            background: colors.theme.background,
                        }}
                    >
                        {content}
                    </span>
                </Popup>
            )}
        </span>
    );
}

export default Tooltip;
