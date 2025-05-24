import Card from "@/components/addons/components/Card";

export default function Download() {
    return (
        <section id="download" className="py-16 px-4 bg-addons-bg">
            <div className="container mx-auto">
                <h2 className="text-3xl font-bold text-center mb-12 text-addons-primary">
                    Download CAT Feature
                </h2>

                <div className="max-w-4xl mx-auto">
                    <Card className="bg-white p-8 shadow-lg border border-gray-200">
                        <div className="text-center mb-8">
                            <h3 className="text-2xl font-bold text- addons-primary mb-2">
                                HolyCluster CAT Feature v1.0.0
                            </h3>
                            <p className="text-gray-600"></p>
                        </div>

                        <div className="grid md:grid-cols-3 gap-4 mb-8">
                            <Card className="p-5 flex flex-col items-center text-center md:col-start-2 hover:shadow-md transition-shadow">
                                <h4 className="font-medium mb-2">Windows</h4>
                                <p className="text-sm text-gray-600 mb-3">Windows 10/11 (64-bit)</p>
                                <button className="w-full text-white bg-addons-secondary hover:bg-addons-primary p-4 rounded-lg">
                                    Download .msi
                                </button>
                            </Card>
                        </div>
                    </Card>
                </div>
            </div>
        </section>
    );
}
