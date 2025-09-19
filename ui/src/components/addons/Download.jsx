import { useCatserverVersion } from "@/hooks/useCatserverVersion";
import Card from "@/components/addons/components/Card";

export default function Download() {
    const { filename } = useCatserverVersion();

    return (
        <section id="download" className="py-8 px-4 bg-addons-bg">
            <div className="container mx-auto">
                <div className="max-w-4xl mx-auto">
                    <Card className="bg-white p-8 shadow-lg border border-gray-200">
                        <h2 className="text-3xl font-bold text-center mb-6 text-addons-primary">
                            Download CAT Server
                        </h2>
                        <div className="text-center mb-4">
                            <h3 className="text-xl font-bold addons-primary mb-2">{filename}</h3>
                            <p className="text-gray-600"></p>
                        </div>

                        <div className="grid md:grid-cols-3 gap-4 mb-4">
                            <Card className="p-5 flex flex-col items-center text-center md:col-start-2 hover:shadow-md transition-shadow">
                                <h4 className="font-medium mb-2">Windows</h4>
                                <p className="text-sm text-gray-600 mb-3">Windows 10/11 (64-bit)</p>
                                <a
                                    className="w-full text-white bg-addons-secondary hover:bg-addons-primary p-4 rounded-lg"
                                    rel="external"
                                    href="/catserver/download"
                                >
                                    Download .msi
                                </a>
                            </Card>
                        </div>
                    </Card>
                </div>
            </div>
        </section>
    );
}
