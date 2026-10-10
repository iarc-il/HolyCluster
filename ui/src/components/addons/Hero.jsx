import Icon from "@/assets/icon.png";
export default function Hero() {
    return (
        <section className="bg-gradient-to-br from-addons-primary to-addons-secondary text-white py-8 px-4">
            <div className="container mx-auto text-center">
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-3 inline-flex items-center gap-4">
                    <a rel="external" href="/">
                        <img
                            className="h-12 md:h-16 lg:h-20 w-auto"
                            src={Icon}
                            alt="Holy Cluster CAT Server"
                        />
                    </a>
                    The Holy Cluster's CAT Server
                </h1>
                <p className="text-xl md:text-2xl mb-8 max-w-3xl mx-auto">
                    We Handle the Radio Work So You Don’t Have To!{" "}
                </p>
            </div>
        </section>
    );
}
