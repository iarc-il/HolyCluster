import Card from "@/components/addons/components/Card";
import { useEffect, useState } from "react";

function platform() {
    return /linux/i.test(navigator.userAgent) ? "linux" : "windows";
}

export default function Download() {
    const [downloads, set_downloads] = useState({});
    const current_platform = platform();
    const alternate_platform = current_platform === "linux" ? "windows" : "linux";
    const current_name = current_platform === "linux" ? "Linux" : "Windows";
    const alternate_name = alternate_platform === "linux" ? "Linux" : "Windows";
    const current_format = current_platform === "linux" ? "AppImage" : "MSI";
    const alternate_format = alternate_platform === "linux" ? "AppImage" : "MSI";

    useEffect(() => {
        Promise.all(
            ["linux", "windows"].map(async target => {
                const response = await fetch(`/catserver/releases/${target}/x86_64`);
                if (!response.ok) return null;

                const location = (await response.json())?.artifact?.location;
                return typeof location === "string" && location.startsWith("/catserver/artifacts/")
                    ? [target, location]
                    : null;
            }),
        )
            .then(results => set_downloads(Object.fromEntries(results.filter(Boolean))))
            .catch(() => set_downloads({}));
    }, []);

    return (
        <section id="download" className="py-8 px-4 bg-addons-bg">
            <div className="container mx-auto">
                <div className="max-w-4xl mx-auto">
                    <Card className="bg-white p-8 shadow-lg border border-gray-200">
                        <h2 className="text-3xl font-bold text-center mb-6 text-addons-primary">
                            Download CAT Server
                        </h2>
                        <div className="mx-auto max-w-2xl text-center">
                            <p className="text-lg text-gray-700">
                                Add CAT control to Holy Cluster by installing the companion server
                                on your computer.
                            </p>
                            {downloads[current_platform] ? (
                                <a
                                    className="mt-6 inline-flex rounded-lg bg-addons-primary px-8 py-4 text-xl font-semibold text-white shadow-lg transition-opacity hover:opacity-75"
                                    href={downloads[current_platform]}
                                >
                                    Download for {current_name}
                                </a>
                            ) : (
                                <span className="mt-6 inline-flex rounded-lg bg-gray-400 px-8 py-4 text-xl font-semibold text-white">
                                    Preparing {current_name} download...
                                </span>
                            )}
                            <p className="mt-2 text-sm text-gray-600">
                                {current_format} for 64-bit systems
                            </p>
                            {downloads[alternate_platform] && (
                                <p className="mt-6 text-sm text-gray-600">
                                    Need the {alternate_name} version?{" "}
                                    <a
                                        className="font-medium text-addons-primary underline underline-offset-2 hover:opacity-75"
                                        href={downloads[alternate_platform]}
                                    >
                                        Download the {alternate_format}
                                    </a>
                                </p>
                            )}
                        </div>
                    </Card>
                </div>
            </div>
        </section>
    );
}
