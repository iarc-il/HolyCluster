export default {
    content: ["./index.html", "./src/**/*.{html,js,jsx}"],
    safelist: [{ pattern: /(active:|hover:)?bg-.+-.+/ }, { pattern: /text-.+/ }],
    theme: {
        extend: {
            screens: {
                "2xs": "400px",
                xs: "500px",
            },
            colors: {
                "addons-primary": "#1a365d",
                "addons-secondary": "#3182ce",
                "addons-bg": "#f7fafc",
            },
        },
    },
    plugins: [],
};
