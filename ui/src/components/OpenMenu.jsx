import { useColors } from "@/hooks/useColors";

function OpenMenu({ size, on_click }) {
    const { colors } = useColors();

    return (
        <button
            type="button"
            onClick={on_click}
            className="cursor-pointer p-0 border-0 bg-transparent"
            style={{ lineHeight: 0 }}
        >
            <svg width={size} height={size} viewBox="0 0 16 16">
                <title>Open menu</title>
                <g fill={colors.buttons.utility}>
                    <path d="m 1 2 h 14 v 2 h -14 z m 0 0" />
                    <path d="m 1 7 h 14 v 2 h -14 z m 0 0" />
                    <path d="m 1 12 h 14 v 2 h -14 z m 0 0" />
                </g>
            </svg>
        </button>
    );
}

export default OpenMenu;
