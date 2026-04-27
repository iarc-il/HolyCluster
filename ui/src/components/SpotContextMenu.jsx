import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useColors } from "@/hooks/useColors";

export default function SpotContextMenu({ x, y, on_close, spot, actions }) {
    const menu_ref = useRef(null);
    const { colors } = useColors();
    const [position, set_position] = useState({ x, y });

    function resolve_value(value) {
        if (typeof value === "function") {
            return value(spot);
        }
        return value;
    }

    useEffect(() => {
        function handle_click_outside(event) {
            if (menu_ref.current && !menu_ref.current.contains(event.target)) {
                on_close();
            }
        }

        function handle_escape_key(event) {
            if (event.key === "Escape") {
                on_close();
            }
        }

        document.body.addEventListener("mousedown", handle_click_outside);
        document.body.addEventListener("keydown", handle_escape_key);

        return () => {
            document.body.removeEventListener("mousedown", handle_click_outside);
            document.body.removeEventListener("keydown", handle_escape_key);
        };
    }, [on_close]);

    useEffect(() => {
        set_position({ x, y });
    }, [x, y]);

    useEffect(() => {
        const menu = menu_ref.current;
        if (!menu) return;

        const rect = menu.getBoundingClientRect();
        const margin = 8;
        const max_x = Math.max(margin, window.innerWidth - rect.width - margin);
        const max_y = Math.max(margin, window.innerHeight - rect.height - margin);
        const clamped_x = Math.min(Math.max(x, margin), max_x);
        const clamped_y = Math.min(Math.max(y, margin), max_y);

        if (clamped_x !== position.x || clamped_y !== position.y) {
            set_position({ x: clamped_x, y: clamped_y });
        }
    }, [x, y, actions, position.x, position.y]);

    return createPortal(
        <div
            ref={menu_ref}
            className="fixed z-50 min-w-[200px] py-2 rounded-lg shadow-lg"
            style={{
                top: `${position.y}px`,
                left: `${position.x}px`,
                backgroundColor: colors.theme.background,
                border: `1px solid ${colors.theme.border}`,
            }}
        >
            {actions.map((action, index) => {
                const disabled = resolve_value(action.disabled);
                const disabled_reason = resolve_value(action.disabled_reason);

                return (
                    <div
                        key={index}
                        className={`px-4 py-2 flex items-center gap-2 ${
                            disabled
                                ? "opacity-50 cursor-not-allowed"
                                : "cursor-pointer hover:bg-opacity-10 hover:bg-white"
                        }`}
                        style={{ color: colors.theme.text }}
                        onClick={() => {
                            if (disabled) return;
                            action.onClick(spot);
                            on_close();
                        }}
                    >
                        {resolve_value(action.label)}
                        {disabled_reason && (
                            <span className="text-xs opacity-80">({disabled_reason})</span>
                        )}
                    </div>
                );
            })}
        </div>,
        document.body,
    );
}
