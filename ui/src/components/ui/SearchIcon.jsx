export default function SearchIcon({ color, className = "", width = "24", height = "24" }) {
    return (
        <svg
            className={className}
            width={width}
            height={height}
            viewBox="0 0 16 16"
            fill="none"
            stroke={color}
            strokeWidth="2"
        >
            <title>Search</title>
            <circle cx="6" cy="6" r="5" />
            <path d="M15 15L10 10" strokeLinecap="round" />
        </svg>
    );
}
