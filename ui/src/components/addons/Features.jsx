import Card from "@/components/addons/components/Card";

export default function Features() {
    return (
        <section id="about" className="py-16 px-4">
            <div className="container mx-auto">
                <h2 className="text-3xl font-bold text-center mb-12 text-addons-primary">
                    What is CAT?
                </h2>

                <div className="max-w-4xl mx-auto">
                    <p className="text-lg mb-8">
                        CAT (Computer-Aided Transceiver) is a powerful feature in HolyCluster that
                        enables seamless communication between your computer and radio transceiver
                        hardware. This integration allows for automated control and monitoring of
                        your radio equipment, enhancing your amateur radio experience.
                    </p>

                    <div className="grid md:grid-cols-2 gap-6 mb-12">
                        <Card className="p-6 shadow-md hover:shadow-lg transition-shadow">
                            <h3 className="text-xl font-semibold mb-3 text-addons-primary">
                                Automated Frequency Control
                            </h3>
                            <p>
                                Automatically tune your radio to the exact frequency when spotting
                                interesting stations from the cluster. No more manual dial turning
                                or missed opportunities.
                            </p>
                        </Card>

                        <Card className="p-6 shadow-md hover:shadow-lg transition-shadow">
                            <h3 className="text-xl font-semibold mb-3 text-addons-primary">
                                Real-Time Data Exchange
                            </h3>
                            <p>
                                Bidirectional communication allows HolyCluster to read current
                                frequency, and mode from your radio while also sending commands.
                            </p>
                        </Card>

                        <Card className="p-6 shadow-md hover:shadow-lg transition-shadow">
                            <h3 className="text-xl font-semibold mb-3 text-addons-primary">
                                Multi-Radio Support
                            </h3>
                            <p>
                                Supports using two radios simultaneously allowing the you to quickly
                                switch between them with the press of a button.{" "}
                            </p>
                        </Card>

                        <Card className="p-6 shadow-md hover:shadow-lg transition-shadow">
                            <h3 className="text-xl font-semibold mb-3 text-addons-primary">
                                Compatibility
                            </h3>
                            <p>
                                Due to the use of OmniRig, HolyCluster is compatible with a wide
                                range of radios.
                            </p>
                        </Card>
                    </div>

                    <div className="bg-white p-6 rounded-lg shadow-md border border-gray-200">
                        <h3 className="text-xl font-semibold mb-3 text-addons-primary">
                            System Requirements
                        </h3>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>Windows 10/11</li>
                            <li>OmniRig</li>
                            <li>Compatible radio transceiver with CAT capability</li>
                            <li>
                                Appropriate interface cable (USB, serial, or other as required by
                                your radio)
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </section>
    );
}
