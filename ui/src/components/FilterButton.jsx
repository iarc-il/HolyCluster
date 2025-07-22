import Triangle from "./Spot/components/Triangle";
import { useColors } from "../hooks/useColors";

function FilterButton({
    text,
    is_active,
    on_click,
    on_mouse_enter,
    on_mouse_leave,
    color,
    text_color = "#000000",
    className,
    hover_brightness = "110",
}) {
    const { colors } = useColors();

    const box_style = [
        "max-w-18",
        "text-center",
        "text-base",
        "rounded-full",
        "cursor-pointer",
        "select-none",
        "w-16",
        `hover:brightness-${hover_brightness}`,
        className ?? "",
    ];

    if (is_active) {
        box_style.push("border", "border-slate-700");
    } else {
        box_style.push(
            "border",
            "border-slate-400",
            "bg-transparent",
            "outline",
            "outline-[1px]",
            "outline-offset-[-1px]",
        );
    }

    return (
        <div
            className={box_style.join(" ")}
            onClick={on_click}
            onMouseEnter={on_mouse_enter}
            onMouseLeave={on_mouse_leave}
            style={{
                backgroundColor: is_active ? color : colors.buttons.disabled_background,
                color: is_active ? text_color : colors.buttons.disabled,
                outlineColor: is_active ? "" : colors.buttons.disabled,
            }}
        >
            <span className="inline-flex items-center space-x-2">{text}</span>
        </div>
    );
}

export default FilterButton;
