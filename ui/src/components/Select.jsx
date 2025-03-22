import { useColors } from "../hooks/useColors";

function Select({ children, text_color, className, ...other_props }) {
    const { colors } = useColors();

    return (
        <select
            className={`rounded-lg px-4 py-2 w-28 ${className}`}
            style={{
                backgroundColor: colors.theme.input_background,
                color: text_color ? text_color : colors.theme.text,
            }}
            {...other_props}
        >
            {children}
        </select>
    );
}

export default Select;
