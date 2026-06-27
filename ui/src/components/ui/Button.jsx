const BG_BASE = {
    blue: "bg-blue-600",
    red: "bg-red-600",
    green: "bg-green-600",
    gray: "bg-gray-600",
};
const BG_HOVER = {
    blue: "hover:bg-blue-700",
    red: "hover:bg-red-700",
    green: "hover:bg-green-700",
    gray: "hover:bg-gray-700",
};
const BG_ACTIVE = {
    blue: "active:bg-blue-800",
    red: "active:bg-red-800",
    green: "active:bg-green-800",
    gray: "active:bg-gray-800",
};
const TEXT_COLORS = {
    white: "text-white",
    black: "text-black",
};

function Button({
    color = "blue",
    text_color = "white",
    on_click = () => {},
    children,
    className,
    ...other_props
}) {
    let input_classes;
    if (className == null) {
        input_classes = [];
    } else {
        input_classes = className.split(" ");
    }

    if (other_props.disabled) {
        color = "gray";
    }
    const classes = [
        TEXT_COLORS[text_color] ?? "",
        BG_BASE[color] ?? "",
        BG_HOVER[color] ?? "",
        BG_ACTIVE[color] ?? "",
        "font-medium",
        "rounded-lg",
        "text-sm",
    ];
    if (!input_classes.find(c => c.startsWith("p-"))) {
        classes.push("p-2");
    }

    classes.push(...input_classes);

    return (
        <button className={classes.join(" ")} onClick={on_click} {...other_props}>
            {children}
        </button>
    );
}

export default Button;
