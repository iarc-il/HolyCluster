import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useColors } from "@/hooks/useColors";

export default function SpotContextMenu({ x, y, on_close, spot, actions }) {
    const menuRef = useRef(null);
    const { colors } = useColors();

    useEffect(() => {
        function handleClickOutside(event) {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                on_close();
            }
        }

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [on_close]);

    return createPortal(
        <div
            ref={menuRef}
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
