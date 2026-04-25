import dxcc_map from "@/maps/dxcc_map.json";
import { geoContains } from "d3-geo";

const WARM_PALETTE = [
    "#fedbb5",
    "#d5b98a",
    "#fab493",
    "#df8073",
    "#bcb759",
    "#98d4c1",
    "#b99881",
    "#89c765",
];

function compute_bounding_box(geometry) {
    let minLon = Infinity,
        maxLon = -Infinity,
        minLat = Infinity,
        maxLat = -Infinity;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
        for (const ring of polygon) {
            for (const [lon, lat] of ring) {
                if (lon < minLon) minLon = lon;
                if (lon > maxLon) maxLon = lon;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
            }
        }
    }
    return { minLon, maxLon, minLat, maxLat };
}

function extract_edges(geometry, snap) {
    const edges = [];
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
        for (const ring of polygon) {
            for (let i = 0; i < ring.length - 1; i++) {
                const a = `${snap(ring[i][0])},${snap(ring[i][1])}`;
                const b = `${snap(ring[i + 1][0])},${snap(ring[i + 1][1])}`;
                edges.push(a < b ? `${a}|${b}` : `${b}|${a}`);
            }
        }
    }
    return edges;
}

function compute_centroid(geometry) {
    let lon_sum = 0;
    let lat_sum = 0;
    let count = 0;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
        for (const ring of polygon) {
            for (let i = 0; i < ring.length - 1; i++) {
                lon_sum += ring[i][0];
                lat_sum += ring[i][1];
                count++;
            }
        }
    }
    return count > 0 ? [lon_sum / count, lat_sum / count] : [0, 0];
}

function sample_boundary(geometry, step) {
    const points = [];
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
        for (const ring of polygon) {
            for (let i = 0; i < ring.length - 1; i++) {
                const [lon1, lat1] = ring[i];
                const [lon2, lat2] = ring[i + 1];
                const diff_lon = lon2 - lon1;
                const diff_lat = lat2 - lat1;
                const length = Math.sqrt(diff_lon * diff_lon + diff_lat * diff_lat);
                const steps = Math.max(1, Math.ceil(length / step));
                for (let s = 0; s <= steps; s++) {
                    const t = s / steps;
                    points.push([lon1 + diff_lon * t, lat1 + diff_lat * t]);
                }
            }
        }
    }
    return points;
}

const ADJ_OFFSETS = [
    [0.05, 0],
    [-0.05, 0],
    [0, 0.05],
    [0, -0.05],
];

function check_contains_with_offsets(feature, lon, lat) {
    for (const [oLon, oLat] of ADJ_OFFSETS) {
        if (geoContains(feature, [lon + oLon, lat + oLat])) return true;
    }
    return false;
}

function compute_coloring(features) {
    const N = features.length;
    const adjacency = Array.from({ length: N }, () => new Set());

    const snap = v => Math.round(v * 1e4) / 1e4;
    const edge_to_features = new Map();
    for (let i = 0; i < N; i++) {
        for (const edge of extract_edges(features[i].geometry, snap)) {
            if (!edge_to_features.has(edge)) edge_to_features.set(edge, []);
            edge_to_features.get(edge).push(i);
        }
    }
    for (const [, fis] of edge_to_features) {
        for (let i = 0; i < fis.length; i++) {
            for (let j = i + 1; j < fis.length; j++) {
                adjacency[fis[i]].add(fis[j]);
                adjacency[fis[j]].add(fis[i]);
            }
        }
    }

    const bounding_boxes = features.map(f => compute_bounding_box(f.geometry));
    const centroids = features.map(f => compute_centroid(f.geometry));

    const CELL_SIZE = 5;
    const grid = new Map();
    for (let i = 0; i < N; i++) {
        const box = bounding_boxes[i];
        for (
            let cx = Math.floor(box.minLon / CELL_SIZE);
            cx <= Math.floor(box.maxLon / CELL_SIZE);
            cx++
        ) {
            for (
                let cy = Math.floor(box.minLat / CELL_SIZE);
                cy <= Math.floor(box.maxLat / CELL_SIZE);
                cy++
            ) {
                const key = `${cx},${cy}`;
                if (!grid.has(key)) grid.set(key, []);
                grid.get(key).push(i);
            }
        }
    }

    for (let i = 0; i < N; i++) {
        const points = sample_boundary(features[i].geometry, 0.5);
        const local_checked = new Set();
        for (const [lon, lat] of points) {
            const cx = Math.floor(lon / CELL_SIZE);
            const cy = Math.floor(lat / CELL_SIZE);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const candidates = grid.get(`${cx + dx},${cy + dy}`);
                    if (!candidates) continue;
                    for (const j of candidates) {
                        if (j === i || adjacency[i].has(j) || local_checked.has(j)) continue;
                        local_checked.add(j);
                        const box = bounding_boxes[j];
                        if (
                            lon < box.minLon ||
                            lon > box.maxLon ||
                            lat < box.minLat ||
                            lat > box.maxLat
                        )
                            continue;
                        if (check_contains_with_offsets(features[j], lon, lat)) {
                            adjacency[i].add(j);
                            adjacency[j].add(i);
                        }
                    }
                }
            }
        }
    }

    for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
            if (adjacency[i].has(j)) continue;
            const box_i = bounding_boxes[i];
            const box_j = bounding_boxes[j];
            if (
                box_i.minLon > box_j.maxLon ||
                box_i.maxLon < box_j.minLon ||
                box_i.minLat > box_j.maxLat ||
                box_i.maxLat < box_j.minLat
            )
                continue;
            if (check_contains_with_offsets(features[j], centroids[i][0], centroids[i][1])) {
                adjacency[i].add(j);
                adjacency[j].add(i);
                continue;
            }
            if (check_contains_with_offsets(features[i], centroids[j][0], centroids[j][1])) {
                adjacency[i].add(j);
                adjacency[j].add(i);
            }
        }
    }

    const order = [...Array(N).keys()].sort((a, b) => adjacency[b].size - adjacency[a].size);
    const colors = new Array(N).fill(-1);
    for (const i of order) {
        const used = new Set();
        for (const n of adjacency[i]) {
            if (colors[n] !== -1) used.add(colors[n]);
        }
        let c = 0;
        while (used.has(c)) c++;
        colors[i] = c;
    }

    return colors;
}

const country_color_indices = compute_coloring(dxcc_map.features);
const num_colors = Math.max(...country_color_indices) + 1;
const MAP_COUNTRY_COLORS = WARM_PALETTE.slice(0, num_colors);

export { country_color_indices, MAP_COUNTRY_COLORS };
