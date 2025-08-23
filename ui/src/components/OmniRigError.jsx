import React from "react";

function OmniRigError() {
    const openOmniRigWebsite = () => {
        window.open("https://www.dxatlas.com/omnirig/", "_blank");
    };

    return (
        <div className="min-h-screen bg-blue-900 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white/10 backdrop-blur-lg rounded-xl shadow-2xl p-8 text-center border border-white/20">
                <div className="mb-6">
                    <div className="w-16 h-16 mx-auto mb-4 bg-red-500/20 rounded-full flex items-center justify-center">
                        <svg
                            className="w-8 h-8 text-red-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                            />
                        </svg>
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-2">OmniRig Required</h1>
                    <p className="text-gray-200 text-sm leading-relaxed">
                        Holy Cluster requires OmniRig to be installed on your system to control your
                        radio.
                    </p>
                </div>

                <div className="space-y-4">
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                        <h3 className="text-blue-300 font-semibold mb-2">What is OmniRig?</h3>
                        <p className="text-gray-200 text-sm">
                            OmniRig is a COM component that provides a standard interface for radio
                            control software to communicate with various amateur radio transceivers.
                        </p>
                    </div>

                    <button
                        onClick={openOmniRigWebsite}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg"
                    >
                        Download OmniRig
                    </button>

                    <div className="text-lg text-gray-200 space-y-1">
                        <p>After installing OmniRig:</p>
                        <ol className="list-decimal list-inside space-y-1 text-left">
                            <li>Restart Holy Cluster</li>
                            <li>Configure your radio in OmniRig</li>
                            <li>Enjoy seamless radio control!</li>
                        </ol>
                    </div>
                </div>

                {window.VERSION ? (
                    <div className="mt-6 pt-4 border-t border-white/10">
                        <p className="text-xs text-gray-500">Holy Cluster v{window.VERSION}</p>
                    </div>
                ) : (
                    ""
                )}
            </div>
        </div>
    );
}

export default OmniRigError;
