import Card from "@/components/addons/components/Card";

export default function Features() {
    return (
        <section id="about" className="py-4 px-4">
            <div className="container mx-auto">
                <h2 className="text-3xl font-bold text-center mb-4 text-addons-primary">
                    How it works?
                </h2>

                <div className="max-w-4xl mx-auto">
                    <p className="text-lg mb-4">
                        CAT Server acts as a bridge between your radio hardware and The Holy
                        Cluster. It communicates with The Holy Cluster via WebSockets and interfaces
                        with OmniRig.
                        <br />
                        When you click on a spot, whether it's on the map, in the table, or on the
                        band bar, the selected frequency and mode information is sent to CAT Server.
                        CAT Server then forwards this information to OmniRig, which handles the
                        actual communication with your radio and applies the changes.
                        <br />
                        It simplifies and speeds up the process of jumping to new stations, making
                        your DXing experience smoother and more efficient.
                    </p>
                </div>
            </div>
        </section>
    );
}
