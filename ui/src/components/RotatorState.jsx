import { useColors } from "@/hooks/useColors";

export default function RotatorState({ status, name, azimuth, moving = false }) {
    const { colors } = useColors();
    const state_color = colors.rotator[status];
    if (!state_color || name === "unconfigured") {
        return null;
    }

    const color = moving ? colors.rotator.moving : state_color;
    const numeric_azimuth = Number(azimuth);
    const heading = Number.isFinite(numeric_azimuth) ? ((numeric_azimuth % 360) + 360) % 360 : 0;
    const title = moving ? "Rotator moving" : `Rotator ${status}`;

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="40"
            height="40"
            fill="none"
            viewBox="0 0 24 24"
            role="img"
            aria-label={title}
            color={color}
        >
            <title>{title}</title>
            {moving && (
                <animate
                    attributeName="color"
                    values={`${colors.rotator.moving};${colors.rotator.moving_flash};${colors.rotator.moving}`}
                    keyTimes="0;0.5;1"
                    dur="800ms"
                    calcMode="discrete"
                    repeatCount="indefinite"
                />
            )}
            <g
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.75"
            >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 3v2m0 14v2M3 12h2m14 0h2" />
                <g transform={`rotate(${heading} 12 12)`}>
                    <path d="M12 12V6" />
                    <path d="m12 4-1.8 3.2h3.6L12 4Z" fill="currentColor" stroke="none" />
                </g>
                <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
            </g>
        </svg>
    );
}
