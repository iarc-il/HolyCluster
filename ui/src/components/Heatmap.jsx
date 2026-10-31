import { bands, continents } from "@/data/filters_data.js";
import { useColors } from "@/hooks/useColors";
import { useProfiles } from "@/hooks/useProfiles.jsx";
import { useSettings } from "@/hooks/useSettings";
import { useSpotData } from "@/hooks/useSpotData";
import { useEffect, useMemo, useRef } from "react";
import simpleheat from "simpleheat";

function Heatmap() {
    const { colors } = useColors();
    const { raw_spots } = useSpotData();
    const { settings } = useSettings();
    const {
        active_profile_data: {
            panels: { heatmap_continent: selected_continent },
        },
        update_active_profile_section,
    } = useProfiles();
    const canvas_ref = useRef(null);
    const heatmap_instance_ref = useRef(null);
    const heatmap_canvas_ref = useRef(null);

    const visible_bands = bands.filter(band => !settings.disabled_bands[band]);

    const heatmap_data = useMemo(() => {
        const counts = {};

        for (const band of visible_bands) {
            counts[band] = {};
            for (const continent of continents) {
                counts[band][continent] = 0;
            }
        }

        for (const spot of raw_spots) {
            if (visible_bands.includes(spot.band)) {
                if (spot.spotter_continent === selected_continent) {
                    counts[spot.band][spot.dx_continent] += 1;
                } else if (spot.dx_continent === selected_continent) {
                    counts[spot.band][spot.spotter_continent] += 1;
                }
            }
        }

        return counts;
    }, [raw_spots, selected_continent, settings]);

    useEffect(() => {
        const canvas = canvas_ref.current;
        return () => {
            canvas.width = 0;
            canvas.height = 0;
            if (heatmap_canvas_ref.current) {
                heatmap_canvas_ref.current.width = 0;
                heatmap_canvas_ref.current.height = 0;
            }
            heatmap_canvas_ref.current = null;
            heatmap_instance_ref.current = null;
        };
    }, []);

    useEffect(() => {
        if (!canvas_ref.current) return;

        const cell_width = 50;
        const cell_height = 50;
        const left_margin = 50;
        const top_margin = 40;
        const width = continents.length * cell_width + left_margin;
        const height = visible_bands.length * cell_height + top_margin + 20;

        const canvas = canvas_ref.current;
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const ctx = canvas.getContext("2d");

        // Only the blurred layer needs pixel reads. Keep labels at full resolution.
        const scale = 0.5;
        if (!heatmap_instance_ref.current) {
            const heatmap_canvas = document.createElement("canvas");
            heatmap_canvas_ref.current = heatmap_canvas;
            heatmap_instance_ref.current = simpleheat(heatmap_canvas);
            heatmap_instance_ref.current.radius(35 * scale, 25 * scale);
            heatmap_instance_ref.current.gradient({
                0: "white",
                0.2: "blue",
                0.4: "cyan",
                0.6: "lime",
                0.8: "yellow",
                1: "red",
            });
        }

        const heatmap_canvas = heatmap_canvas_ref.current;
        const heatmap_width = Math.ceil(width * scale);
        const heatmap_height = Math.ceil(height * scale);
        if (heatmap_canvas.width !== heatmap_width || heatmap_canvas.height !== heatmap_height) {
            heatmap_canvas.width = heatmap_width;
            heatmap_canvas.height = heatmap_height;
            heatmap_instance_ref.current.resize();
        }

        const points = [];
        visible_bands.forEach((band, band_index) => {
            continents.forEach((continent, continent_index) => {
                const value = heatmap_data[band]?.[continent] || 0;
                const point = [
                    (left_margin + continent_index * cell_width + cell_width / 2) * scale,
                    (top_margin + band_index * cell_height + cell_height / 2) * scale,
                    Math.min(value, 20),
                ];
                points.push(point);
            });
        });

        heatmap_instance_ref.current.data(points);
        heatmap_instance_ref.current.max(20);
        heatmap_instance_ref.current.draw(0);

        ctx.clearRect(0, 0, width, height);

        ctx.strokeStyle = colors.theme.borders;
        ctx.lineWidth = 3;

        for (let i = 1; i < continents.length; i++) {
            ctx.beginPath();
            ctx.moveTo(left_margin + i * cell_width, top_margin);
            ctx.lineTo(
                left_margin + i * cell_width,
                top_margin + visible_bands.length * cell_height,
            );
            ctx.stroke();
        }

        for (let i = 1; i < visible_bands.length; i++) {
            ctx.beginPath();
            ctx.moveTo(left_margin, top_margin + i * cell_height);
            ctx.lineTo(left_margin + continents.length * cell_width, top_margin + i * cell_height);
            ctx.stroke();
        }

        ctx.drawImage(heatmap_canvas, 0, 0, width, height);

        ctx.font = "bold 24px sans-serif";
        ctx.fillStyle = colors.theme.text;
        ctx.textAlign = "start";
        ctx.textBaseline = "middle";

        visible_bands.forEach((band, index) => {
            ctx.fillText(String(band), 0, top_margin + index * cell_height + cell_height / 2);
        });

        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";

        continents.forEach((continent, index) => {
            ctx.fillText(continent, left_margin + index * cell_width + cell_width / 2, 20);
        });
    }, [heatmap_data, colors.theme.text, colors.theme.borders, settings]);

    return (
        <div className="pt-2" data-tour="heatmap-panel">
            <div className="flex justify-between items-center pb-3" data-tour="heatmap-controls">
                <div style={{ color: colors.theme.text }}>
                    <span className="text-sm">Continent:</span>
                    <select
                        value={selected_continent}
                        data-tour="heatmap-continent-selector"
                        onChange={event =>
                            update_active_profile_section("panels", panels => ({
                                ...panels,
                                heatmap_continent: event.target.value,
                            }))
                        }
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

            <div data-tour="heatmap-chart">
                <canvas
                    ref={canvas_ref}
                    style={{
                        width: "100%",
                        height: "auto",
                        backgroundColor: colors.theme.background,
                    }}
                />
            </div>

            <div className="mt-4" data-tour="heatmap-legend" style={{ color: colors.theme.text }}>
                <div className="flex items-center justify-between text-xs mb-1">
                    <span>0</span>
                    <span>9</span>
                    <span>11</span>
                    <span>13</span>
                    <span>19</span>
                    <span>20</span>
                </div>
                <div
                    className="h-4 rounded"
                    style={{
                        background:
                            "linear-gradient(to right, white 0%, blue 20%, cyan 40%, lime 60%, yellow 80%, red 100%)",
                        border: `1px solid ${colors.theme.borders}`,
                    }}
                />
            </div>

            <div className="text-xs text-center p-4" style={{ color: colors.theme.text }}>
                The heatmap is calculated from the reported spots from/to the selected continent in
                the last hour.
            </div>
        </div>
    );
}

export default Heatmap;
