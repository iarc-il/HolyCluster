function ConnectionState({ size, color, title }) {
    const connectedIcon = (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            fill="none"
            viewBox="0 0 24 24"
        >
            <title>Connected</title>
            <path
                stroke={color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M10 18a2 2 0 0 0 4 0m-4 0a2 2 0 0 1 4 0m-4 0H3m11 0h7M5 9.897c0-1.714 1.46-3.104 3.26-3.104.275-1.22 1.255-2.215 2.572-2.611 1.317-.396 2.77-.134 3.811.69 1.042.822 1.514 2.08 1.239 3.3h.693A2.42 2.42 0 0 1 19 10.586 2.42 2.42 0 0 1 16.575 13H8.26C6.46 13 5 11.61 5 9.897Z"
            />
            <path stroke={color} strokeWidth="2" d="M12 16v-3" />
        </svg>
    );

    const disconnectedIcon = (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            fill="none"
            viewBox="0 0 24 24"
        >
            <title>Disconnected</title>
            <path
                stroke={color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M10 18a2 2 0 0 0 4 0m-4 0a2 2 0 0 1 4 0m-4 0H3m11 0h7M5 9.897c0-1.714 1.46-3.104 3.26-3.104.275-1.22 1.255-2.215 2.572-2.611 1.317-.396 2.77-.134 3.811.69 1.042.822 1.514 2.08 1.239 3.3h.693A2.42 2.42 0 0 1 19 10.586 2.42 2.42 0 0 1 16.575 13H8.26C6.46 13 5 11.61 5 9.897Z"
            />
            <path
                stroke={color}
                strokeLinecap="round"
                strokeWidth="2"
                d="m6.245 15.255 11.51-11.51"
            />
        </svg>
    );

    return title === "connected" ? connectedIcon : disconnectedIcon;
}

export default ConnectionState;
