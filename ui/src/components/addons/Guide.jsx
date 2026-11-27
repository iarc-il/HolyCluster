import Card from "@/components/addons/components/Card";

export default function Guide() {
    return (
        <section id="guide" className="py-6 px-4 bg-white">
            <div className="container mx-auto">
                <h2 className="text-3xl font-bold text-center mb-4 text-addons-primary">
                    Get started
                </h2>

                <div className="max-w-4xl mx-auto space-y-8">
                    <GuideStep step={1}>
                        <h3 className="text-xl font-semibold mb-3 text-addons-primary">
                            Open CAT Control
                        </h3>
                        <p className="text-gray-700">
                            CAT Control opens Holy Cluster in your default browser.
                        </p>
                    </GuideStep>
                    <GuideStep step={2}>
                        <h3 className="text-xl font-semibold mb-3 text-addons-primary">
                            Configure your radio
                        </h3>
                        <p className="text-gray-700">
                            Open Settings, select CAT Control, and configure your radio.
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
