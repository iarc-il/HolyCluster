import * as Sentry from "@sentry/react";
import React from "react";

function ErrorFallback({ resetError }) {
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
                    onClick={resetError}
                    type="button"
                >
                    Try again
                </button>
            </section>
        </main>
    );
}

function RouteErrorBoundary({ children }) {
    const [retry_key, set_retry_key] = React.useState(0);

    return (
        <Sentry.ErrorBoundary
            fallback={ErrorFallback}
            onReset={() => set_retry_key(current_key => current_key + 1)}
        >
            <React.Fragment key={retry_key}>{children}</React.Fragment>
        </Sentry.ErrorBoundary>
    );
}

export default RouteErrorBoundary;
