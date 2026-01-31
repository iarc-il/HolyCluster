import { useEffect, useRef } from "react";
import Input from "@/components/Input.jsx";
import X from "@/components/X.jsx";
import { useColors } from "@/hooks/useColors";

export default function CallsignSearch({
    is_open,
    search_text,
    set_search_text,
    on_close,
    on_enter,
}) {
    const input_ref = useRef(null);
    const { colors } = useColors();

    useEffect(() => {
        if (is_open && input_ref.current) {
            input_ref.current.focus();
        }
    }, [is_open]);

    useEffect(() => {
        const handle_escape = event => {
            if (event.key === "Escape" && is_open) {
                on_close();
            }
        };

        document.addEventListener("keydown", handle_escape);
        return () => document.removeEventListener("keydown", handle_escape);
    }, [is_open, on_close]);

    if (!is_open) return null;

    return (
        <div
            className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-50 flex items-center justify-around gap-4 px-4 py-2 rounded-xl shadow-lg"
            style={{
                backgroundColor: colors.theme.background,
                border: `2px solid ${colors.theme.borders}`,
            }}
        >
            <svg
                width="18"
                height="18"
                viewBox="0 0 16 16"
                fill="none"
                stroke={colors.theme.text}
                strokeWidth="2"
            >
                <circle cx="6" cy="6" r="5" />
                <path d="M15 15L10 10" strokeLinecap="round" />
            </svg>

            <Input
                ref={input_ref}
                className="w-64"
                placeholder="Search callsign..."
                value={search_text}
                onChange={e => set_search_text(e.target.value)}
                onKeyDown={e => {
                    if (e.key === "Enter" && search_text.trim()) {
                        on_enter(search_text.trim());
                    }
                }}
                onBlur={on_close}
            />

            <X size="20" on_click={on_close} />
        </div>
    );
}
