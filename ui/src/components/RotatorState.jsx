const state_colors = {
    connected: "#00EE00",
    disconnected: "#EE0000",
};

export default function RotatorState({ status, name, azimuth }) {
    const color = state_colors[status];
    if (!color || name === "unconfigured") {
        return null;
    }

    const numeric_azimuth = Number(azimuth);
    const heading = Number.isFinite(numeric_azimuth) ? ((numeric_azimuth % 360) + 360) % 360 : 0;
    const title = `Rotator ${status}`;

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="40"
            height="40"
            fill="none"
            viewBox="0 0 24 24"
            role="img"
            aria-label={title}
        >
            <title>{title}</title>
            <g stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 3v2m0 14v2M3 12h2m14 0h2" />
                <g transform={`rotate(${heading} 12 12)`}>
                    <path d="M12 12V6" />
                    <path d="m12 4-1.8 3.2h3.6L12 4Z" fill={color} stroke="none" />
                </g>
                <circle cx="12" cy="12" r="1.25" fill={color} stroke="none" />
            </g>
        </svg>
    );
}
