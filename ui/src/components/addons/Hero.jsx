import Icon from "@/icon.png";
export default function Hero() {
    return (
        <section className="bg-gradient-to-br from-addons-primary to-addons-secondary text-white py-8 px-4">
            <div className="container mx-auto text-center">
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-3 inline-flex items-center gap-4">
                    <a rel="external" href="/">
                        <img className="h-12 md:h-16 lg:h-20 w-auto" src={Icon} />
                    </a>
                    The Holy Cluster's CAT Server
                </h1>
                <p className="text-xl md:text-2xl mb-8 max-w-3xl mx-auto">
                    We Handle the Radio Work So You Don’t Have To!{" "}
                </p>
                <div className="flex flex-col-reverse sm:flex-row justify-center gap-4">
                    <a href="#download">
                        <button className="px-5 py-3 text-xl hover:opacity-75 transition-opacity bg-addons-primary rounded-lg">
                            Download Now
                        </button>
                    </a>
                    <a href="#about">
                        <button className="px-5 py-3 text-xl bg-white hover:opacity-75 transition-opacity text-addons-primary rounded-lg">
                            Learn More
                        </button>
                    </a>
                </div>
            </div>
        </section>
    );
}
