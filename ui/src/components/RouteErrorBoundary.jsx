import * as Sentry from "@sentry/react";
import React from "react";

class RouteErrorBoundary extends React.Component {
    state = { has_error: false };

    static getDerivedStateFromError() {
        return { has_error: true };
    }

    componentDidCatch(error) {
        Sentry.captureException(error);
    }

    retry = () => {
        this.setState({ has_error: false });
    };

    render() {
        if (this.state.has_error) {
            return (
                <main
                    className="min-h-screen bg-blue-900 flex items-center justify-center p-4 text-white"
                    role="alert"
                >
                    <section className="max-w-md w-full bg-white/10 backdrop-blur-lg rounded-xl shadow-2xl p-8 text-center border border-white/20">
                        <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
                        <p className="text-gray-200 mb-6">
                            Please try again. If the problem continues, reload the page.
                        </p>
                        <button
                            className="bg-blue-600 hover:bg-blue-700 py-3 px-6 rounded-lg font-semibold"
                            onClick={this.retry}
                            type="button"
                        >
                            Try again
                        </button>
                    </section>
                </main>
            );
        }

        return this.props.children;
    }
}

export default RouteErrorBoundary;
