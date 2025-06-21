import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useColors } from "@/hooks/useColors";

export default function SpotContextMenu({ x, y, on_close, spot, actions }) {
    const menu_ref = useRef(null);
    const { colors } = useColors();

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

    return createPortal(
        <div
            ref={menu_ref}
            className="fixed z-50 min-w-[200px] py-2 rounded-lg shadow-lg"
            style={{
                top: `${y}px`,
                left: `${x}px`,
                backgroundColor: colors.theme.background,
                border: `1px solid ${colors.theme.border}`,
            }}
        >
            {actions.map((action, index) => (
                <div
                    key={index}
                    className="px-4 py-2 hover:bg-opacity-10 hover:bg-white cursor-pointer flex items-center gap-2"
                    style={{ color: colors.theme.text }}
                    onClick={() => {
                        action.onClick(spot);
                        on_close();
                    }}
                >
                    {action.label(spot)}
                </div>
            ))}
        </div>,
        document.body,
    );
}
