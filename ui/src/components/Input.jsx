import { useColors } from "@/hooks/useColors";

function Input({ className, type = "text", ...props_without_classes }) {
    const { colors } = useColors();

    if (className == null) {
        className = "";
    }
    className +=
        " shadow appearance-none border rounded-lg w-24 py-2 px-3 leading-tight focus:outline-none focus:shadow-outline";

    const color =
        props_without_classes.disabled != null ? colors.theme.disabled_text : colors.theme.text;

    return (
        <input
            style={{
                backgroundColor: colors.theme.input_background,
                borderColor: colors.theme.borders,
                color,
            }}
            className={className}
            type={type}
            {...props_without_classes}
        />
    );
}

export default Input;
