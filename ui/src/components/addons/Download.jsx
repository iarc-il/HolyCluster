import Card from "@/components/addons/components/Card";

function platform() {
    return /linux/i.test(navigator.userAgent) ? "linux" : "windows";
}

export default function Download() {
    const current_platform = platform();
    const alternate_platform = current_platform === "linux" ? "windows" : "linux";
    const current_name = current_platform === "linux" ? "Linux" : "Windows";
    const alternate_name = alternate_platform === "linux" ? "Linux" : "Windows";
    const current_format = current_platform === "linux" ? "AppImage" : "MSI";
    const alternate_format = alternate_platform === "linux" ? "AppImage" : "MSI";

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
                            <a
                                className="mt-6 inline-flex rounded-lg bg-addons-primary px-8 py-4 text-xl font-semibold text-white shadow-lg transition-opacity hover:opacity-75"
                                href={`/catserver/download/${current_platform}/x86_64`}
                                download
                            >
                                Download for {current_name}
                            </a>
                            <p className="mt-2 text-sm text-gray-600">
                                {current_format} for 64-bit systems
                            </p>
                            <p className="mt-6 text-sm text-gray-600">
                                Need the {alternate_name} version?{" "}
                                <a
                                    className="font-medium text-addons-primary underline underline-offset-2 hover:opacity-75"
                                    href={`/catserver/download/${alternate_platform}/x86_64`}
                                    download
                                >
                                    Download the {alternate_format}
                                </a>
                            </p>
                        </div>
                    </Card>
                </div>
            </div>
        </section>
    );
}
