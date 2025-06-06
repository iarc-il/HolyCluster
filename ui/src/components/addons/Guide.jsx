import Card from "@/components/addons/components/Card";

export default function Guide() {
    return (
        <section id="guide" className="py-6 px-4 bg-white">
            <div className="container mx-auto">
                <h2 className="text-3xl font-bold text-center mb-4 text-addons-primary">
                    Installation Guide
                </h2>

                <div className="max-w-4xl mx-auto space-y-8">
                    <GuideStep step={1}>
                        <h3 className="text-xl font-semibold mb-3 text-addons-primary">
                            Download the Server
                        </h3>
                        <p className="text-gray-700">
                            <ul className="list-none">
                                <li>Download the latest version of the CAT Server from the download section above.</li>
                                <li>Run the installation file and follow the on-screen instructions.</li>
                            </ul>
                        </p>
                    </GuideStep>

                    <GuideStep step={2}>
                        <h3 className="text-xl font-semibold mb-3 text-addons-primary">
                            Connect to OmniRig
                        </h3>
                        <p className="text-gray-700">
                            <ul>
                                <li>Download and install the latest version of <a className="underline bold" href="https://dxatlas.com/OmniRig/Files/OmniRig.zip">OmniRig</a>.</li>
                                <li>Use it to connect your radio to your computer.</li>
                            </ul>
                        </p>
                    </GuideStep>

                    <GuideStep step={3}>
                        <h3 className="text-xl font-semibold mb-3 text-addons-primary">
                            Launch The Holy Cluster
                        </h3>
                        <p className="text-gray-700">
                            <ul>
                                <li>Once the CAT Server is installed and configured, start The Holy Cluster by clicking its desktop icon.</li>
                                <li>This will automatically launch the CAT Server and open The Holy Cluster in your default web browser.</li>
                            </ul>
                        </p>
                    </GuideStep>
                </div>
            </div>
        </section>
    );
}

function GuideStep({ step, children }) {
    return (
        <Card className="shadow-md relative">
            <div className="-translate-x-1/2 -translate-y-1/2 absolute sm:w-10 sm:h-10 w-8 h-8 text-lg rounded-full bg-addons-primary sm:text-xl flex items-center justify-center text-white font-bold">
                {step}
            </div>
            <div className="m-6">{children}</div>
        </Card>
    );
}
