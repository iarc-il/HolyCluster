import UpdateControls from "@/components/UpdateControls.jsx";
import Card from "@/components/addons/components/Card";

export default function Download() {
    return (
        <section id="download" className="py-8 px-4 bg-addons-bg">
            <div className="container mx-auto">
                <div className="max-w-4xl mx-auto">
                    <Card className="bg-white p-8 shadow-lg border border-gray-200">
                        <h2 className="text-3xl font-bold text-center mb-6 text-addons-primary">
                            Download CAT Server
                        </h2>
                        <UpdateControls />
                    </Card>
                </div>
            </div>
        </section>
    );
}
