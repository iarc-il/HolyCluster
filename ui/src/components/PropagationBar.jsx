import { useRef, useState } from "react";
import Bar from "@/components/Bar.jsx";
import Popup from "@/components/Popup.jsx";
import { useColors } from "@/hooks/useColors";

function PropagationBar({
    value,
    timestamp,
    label,
    min,
    max,
    low_mid,
    mid_high,
    reverse_colors = false,
}) {
    const { colors } = useColors();
    const bar_ref = useRef(null);
    const [show_popup, set_show_popup] = useState(false);

    function format_timestamp(timestamp) {
        const date = new Date(timestamp * 1000);
        return date.toLocaleString();
    }

    return (
        <div
            ref={bar_ref}
            onMouseEnter={() => set_show_popup(true)}
            onMouseLeave={() => set_show_popup(false)}
        >
            <Bar
                value={Math.round(value)}
                label={label}
                min={min}
                max={max}
                low_mid={low_mid}
                mid_high={mid_high}
                reverse_colors={reverse_colors}
            />
            {show_popup && (
                <Popup anchor_ref={bar_ref}>
                    <div
                        className="py-1 px-2 rounded shadow-lg"
                        style={{
                            color: colors.theme.text,
                            background: colors.theme.background,
                        }}
                    >
                        {format_timestamp(timestamp)}
                    </div>
                </Popup>
            )}
        </div>
    );
}

export default PropagationBar;
