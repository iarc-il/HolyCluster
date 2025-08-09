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
    let classes = [
        `text-${text_color}`,
        `bg-${color}-600`,
        `active:bg-${color}-800`,
        `hover:bg-${color}-700`,
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
