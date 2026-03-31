import { useState, useRef, useCallback } from "react";

export default function Tooltip({ text, delay = 0, children }) {
    const [visible, set_visible] = useState(false);
    const [pos, set_pos] = useState({ x: 0, y: 0 });
    const timer_ref = useRef(null);

    const handle_mouse_enter = useCallback(e => {
        set_pos({ x: e.clientX, y: e.clientY });
        timer_ref.current = setTimeout(() => set_visible(true), delay);
    }, [delay]);

    const handle_mouse_move = useCallback(e => {
        set_pos({ x: e.clientX, y: e.clientY });
    }, []);

    const handle_mouse_leave = useCallback(() => {
        clearTimeout(timer_ref.current);
        set_visible(false);
    }, []);

    return (
        <span
            onMouseEnter={handle_mouse_enter}
            onMouseMove={handle_mouse_move}
            onMouseLeave={handle_mouse_leave}
        >
            {children}
            {visible && (
                <div
                    style={{
                        position: "fixed",
                        left: pos.x + 12,
                        top: pos.y + 12,
                        backgroundColor: "#1e293b",
                        color: "#f1f5f9",
                        border: "1px solid #475569",
                        borderRadius: "6px",
                        padding: "10px 14px",
                        fontSize: "14px",
                        lineHeight: "1.6",
                        maxWidth: "260px",
                        zIndex: 9999,
                        pointerEvents: "none",
                        whiteSpace: "pre-line",
                    }}
                >
                    {text}
                </div>
            )}
        </span>
    );
}
