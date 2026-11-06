import Icon from "@/assets/icon.png";
export default function Hero() {
    return (
        <section className="bg-gradient-to-br from-addons-primary to-addons-secondary text-white py-8 px-4">
            <div className="container mx-auto text-center">
                <div className="mb-3 inline-flex items-center gap-4">
                    <a rel="external" href="/" aria-label="Holy Cluster home">
                        <img className="h-12 md:h-16 lg:h-20 w-auto" src={Icon} alt="" />
                    </a>
                    <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold">CAT Control</h1>
                </div>
            </div>
        </section>
    );
}
