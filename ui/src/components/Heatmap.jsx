import { useMemo, useEffect, useRef } from "react";
import { useLocalStorage } from "@uidotdev/usehooks";
import simpleheat from "simpleheat";
import { useColors } from "@/hooks/useColors";
import { useServerData } from "@/hooks/useServerData";
import { bands, continents } from "@/filters_data.js";

function Heatmap() {
    const { colors } = useColors();
    const { raw_spots } = useServerData();
    const [selected_continent, set_selected_continent] = useLocalStorage("heatmap_continent", "EU");
    const canvas_ref = useRef(null);
    const heatmap_instance_ref = useRef(null);

    const heatmap_data = useMemo(() => {
        const current_time = Math.floor(Date.now() / 1000);
        const one_hour_ago = current_time - 3600;

        const filtered_spots = raw_spots.filter(
            spot => spot.time >= one_hour_ago && spot.spotter_continent === selected_continent,
        );

        const counts = {};
        let max_count = 0;

        for (const band of bands) {
            counts[band] = {};
            for (const continent of continents) {
                counts[band][continent] = 0;
            }
        }

        for (const spot of filtered_spots) {
            if (counts[spot.band] && spot.dx_continent) {
                counts[spot.band][spot.dx_continent] =
                    (counts[spot.band][spot.dx_continent] || 0) + 1;
                max_count = Math.max(max_count, counts[spot.band][spot.dx_continent]);
            }
        }

        return { counts, max_count };
    }, [raw_spots, selected_continent]);

    useEffect(() => {
        if (!canvas_ref.current) return;

        const cell_width = 50;
        const cell_height = 30;
        const left_margin = 50;
        const top_margin = 30;
        const width = continents.length * cell_width + left_margin;
        const height = bands.length * cell_height + top_margin;

        canvas_ref.current.width = width;
        canvas_ref.current.height = height;

        const ctx = canvas_ref.current.getContext("2d");

        ctx.save();

        if (!heatmap_instance_ref.current) {
            heatmap_instance_ref.current = simpleheat(canvas_ref.current);
            heatmap_instance_ref.current.radius(25, 15);
            heatmap_instance_ref.current.gradient({
                0: "blue",
                0.25: "cyan",
                0.5: "lime",
                0.65: "yellow",
                0.85: "orange",
                1: "red",
            });
        }

        const points = [];
        bands.forEach((band, bandIndex) => {
            continents.forEach((continent, continentIndex) => {
                const value = heatmap_data.counts[band]?.[continent] || 0;
                points.push([
                    left_margin + continentIndex * cell_width + cell_width / 2,
                    top_margin + bandIndex * cell_height + cell_height / 2,
                    value,
                ]);
            });
        });

        heatmap_instance_ref.current.data(points);
        heatmap_instance_ref.current.max(heatmap_data.max_count || 1);
        heatmap_instance_ref.current.draw(0.05);

        ctx.restore();

        ctx.font = "bold 24px sans-serif";
        ctx.fillStyle = colors.theme.text;
        ctx.textAlign = "start";
        ctx.textBaseline = "middle";

        bands.forEach((band, index) => {
            ctx.fillText(String(band), 0, top_margin + index * cell_height + cell_height / 2);
        });

        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";

        continents.forEach((continent, index) => {
            ctx.fillText(continent, left_margin + index * cell_width + cell_width / 2, 20);
        });
    }, [heatmap_data, colors.theme.text]);

    return (
        <div className="pt-2">
            <div className="flex justify-between items-center pb-3">
                <div style={{ color: colors.theme.text }}>
                    <span className="text-sm">Your Continent is </span>
                    <select
                        value={selected_continent}
                        onChange={e => set_selected_continent(e.target.value)}
                        className="h-7 px-2 rounded-md text-sm ml-1"
                        style={{
                            backgroundColor: colors.theme.input_background,
                            color: colors.theme.text,
                            border: `1px solid ${colors.theme.borders}`,
                        }}
                    >
                        <option value="EU">Europe</option>
                        <option value="NA">North America</option>
                        <option value="SA">South America</option>
                        <option value="AS">Asia</option>
                        <option value="AF">Africa</option>
                        <option value="OC">Oceania</option>
                    </select>
                </div>
            </div>

            <div>
                <canvas
                    ref={canvas_ref}
                    style={{
                        width: "100%",
                        height: "auto",
                        backgroundColor: colors.theme.background,
                    }}
                />
            </div>

            {heatmap_data.max_count > 0 && (
                <div className="mt-4" style={{ color: colors.theme.text }}>
                    <div className="flex items-center justify-between text-xs mb-1">
                        <span>0</span>
                        <span>{Math.round(heatmap_data.max_count / 2)}</span>
                        <span>{heatmap_data.max_count}</span>
                    </div>
                    <div
                        className="h-4 rounded"
                        style={{
                            background:
                                "linear-gradient(to right, blue, cyan, lime, yellow, orange, red)",
                            border: `1px solid ${colors.theme.borders}`,
                        }}
                    />
                </div>
            )}
        </div>
    );
}

export default Heatmap;
