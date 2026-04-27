#!/usr/bin/env python3
"""Simplify a GeoJSON FeatureCollection using TopoJSON shared-arc simplification.

Adjacent polygons keep consistent borders because shared arcs are simplified once
and reused by all features that reference them.

Before simplification, the script:
1. Fixes overlapping zones using geometric operations (Shapely difference)
2. Realigns borders: after clipping, the simplified zone's boundary vertices
   are replaced with the authoritative neighbor's vertices so they form
   shared arcs detectable by TopoJSON

Usage:
    python simplify_geojson.py <input.json> <output.json> [tolerance]

Arguments:
    input.json    Path to the source GeoJSON FeatureCollection
    output.json   Path to write the simplified GeoJSON
    tolerance     Simplification tolerance in degrees (default: 0.3)
                  Higher = more simplification, lower = more detail
                  0.3 ≈ 33km, 0.5 ≈ 55km, 1.0 ≈ 111km at equator

Requirements:
    pip install topojson shapely
"""

import json
import sys

OVERLAP_AREA_THRESHOLD = 1e-6

try:
    import topojson
    from shapely.geometry import shape, mapping, LineString, MultiPoint, MultiPolygon
    from shapely.geometry.polygon import orient
    from shapely.ops import split
    from shapely.validation import make_valid
    from shapely.errors import GEOSException
except ImportError:
    print("Error: topojson and shapely are required.", file=sys.stderr)
    print("Install them with: pip install topojson shapely", file=sys.stderr)
    sys.exit(1)


def count_coordinates(geojson):
    total = 0
    for feature in geojson["features"]:
        geom = feature["geometry"]
        if geom["type"] == "Polygon":
            total += sum(len(ring) for ring in geom["coordinates"])
        elif geom["type"] == "MultiPolygon":
            total += sum(
                sum(len(ring) for ring in polygon)
                for polygon in geom["coordinates"]
            )
    return total


def ring_point_count(geom):
    if geom["type"] == "Polygon":
        return len(geom["coordinates"][0])
    if geom["type"] == "MultiPolygon":
        return sum(len(p[0]) for p in geom["coordinates"])
    return 0


def ensure_lists(obj):
    if isinstance(obj, dict):
        return {k: ensure_lists(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [ensure_lists(v) for v in obj]
    return obj


def normalize_geometries(data):
    for feature in data["features"]:
        geom = shape(feature["geometry"])
        if geom.is_valid:
            continue
        fixed = make_valid(geom)
        feature["geometry"] = ensure_lists(mapping(fixed))


def normalize_ring_orientation(data):
    for feature in data["features"]:
        geom = shape(feature["geometry"])

        if geom.geom_type == "Polygon":
            normalized = orient(geom, sign=-1.0)
        elif geom.geom_type == "MultiPolygon":
            normalized = MultiPolygon([orient(poly, sign=-1.0) for poly in geom.geoms])
        else:
            continue

        feature["geometry"] = ensure_lists(mapping(normalized))


def fix_overlaps(data):
    features = data["features"]
    n = len(features)
    shapes = [shape(f["geometry"]) for f in features]

    for i in range(n):
        for j in range(i + 1, n):
            if not shapes[i].intersects(shapes[j]):
                continue

            try:
                overlap = shapes[i].intersection(shapes[j])
            except GEOSException:
                continue
            if overlap.area < OVERLAP_AREA_THRESHOLD:
                continue

            pts_i = ring_point_count(features[i]["geometry"])
            pts_j = ring_point_count(features[j]["geometry"])

            if pts_i <= pts_j:
                simpler, authoritative = i, j
            else:
                simpler, authoritative = j, i

            try:
                fixed = shapes[simpler].difference(shapes[authoritative])
            except GEOSException:
                continue
            if fixed.is_valid and fixed.area > 0:
                shapes[simpler] = fixed
                features[simpler]["geometry"] = ensure_lists(mapping(fixed))


def find_in_ring(ring, lon, lat, tol=0.01):
    for i, p in enumerate(ring):
        if abs(p[0] - lon) < tol and abs(p[1] - lat) < tol:
            return i
    return None


def realign_borders(data):
    features = data["features"]
    n = len(features)
    shapes = [shape(f["geometry"]) for f in features]

    for i in range(n):
        if shapes[i].geom_type != "Polygon":
            continue
        ring_i = features[i]["geometry"]["coordinates"][0]

        for j in range(n):
            if i == j or shapes[j].geom_type != "Polygon":
                continue
            if not shapes[i].intersects(shapes[j]):
                continue

            ring_j = features[j]["geometry"]["coordinates"][0]

            boundary_i = LineString(ring_i)
            boundary_j = LineString(ring_j)
            try:
                intersection = boundary_i.intersection(boundary_j)
            except GEOSException:
                continue

            pts = []
            if intersection.geom_type == "Point":
                pts = [(intersection.x, intersection.y)]
            elif intersection.geom_type == "MultiPoint":
                pts = [(p.x, p.y) for p in intersection.geoms]
            elif intersection.geom_type == "GeometryCollection":
                for g in intersection.geoms:
                    if g.geom_type == "Point":
                        pts.append((g.x, g.y))

            if len(pts) < 2:
                continue

            split_pts = MultiPoint(pts)
            try:
                segs_i = list(split(boundary_i, split_pts).geoms)
                segs_j = list(split(boundary_j, split_pts).geoms)
            except Exception:
                continue

            for seg_i in segs_i:
                mid = seg_i.interpolate(0.5, normalized=True)
                dist_to_j = mid.distance(boundary_j)

                if dist_to_j > 0.5:
                    continue

                start_pt = list(seg_i.coords)[0]
                end_pt = list(seg_i.coords)[-1]

                best_replacement = None
                best_len = float("inf")
                for seg_j in segs_j:
                    j_start = list(seg_j.coords)[0]
                    j_end = list(seg_j.coords)[-1]
                    if (
                        abs(j_start[0] - start_pt[0]) < 0.01
                        and abs(j_start[1] - start_pt[1]) < 0.01
                        and abs(j_end[0] - end_pt[0]) < 0.01
                        and abs(j_end[1] - end_pt[1]) < 0.01
                    ):
                        if len(seg_j.coords) < best_len:
                            best_len = len(seg_j.coords)
                            best_replacement = list(seg_j.coords)
                    elif (
                        abs(j_start[0] - end_pt[0]) < 0.01
                        and abs(j_start[1] - end_pt[1]) < 0.01
                        and abs(j_end[0] - start_pt[0]) < 0.01
                        and abs(j_end[1] - start_pt[1]) < 0.01
                    ):
                        if len(seg_j.coords) < best_len:
                            best_len = len(seg_j.coords)
                            best_replacement = list(seg_j.coords)[::-1]

                if best_replacement is None:
                    continue

                replacement = best_replacement
                if len(replacement) >= len(seg_i.coords):
                    continue

                i_start = find_in_ring(ring_i, start_pt[0], start_pt[1])
                i_end = find_in_ring(ring_i, end_pt[0], end_pt[1])
                if i_start is None or i_end is None:
                    continue

                if i_end > i_start:
                    new_ring = ring_i[: i_start + 1] + replacement[1:-1] + ring_i[i_end:]
                else:
                    new_ring = replacement + ring_i[i_end + 1 : i_start]

                if new_ring[0] != new_ring[-1]:
                    new_ring.append(new_ring[0])

                ring_i = new_ring
                features[i]["geometry"]["coordinates"][0] = ring_i


def simplify_geojson(input_path, output_path, tolerance=0.3):
    with open(input_path) as f:
        data = json.load(f)

    if data.get("type") != "FeatureCollection" or not isinstance(
        data.get("features"), list
    ):
        print("Error: input must be a GeoJSON FeatureCollection", file=sys.stderr)
        sys.exit(1)

    before = count_coordinates(data)

    normalize_geometries(data)
    normalize_ring_orientation(data)
    fix_overlaps(data)
    realign_borders(data)

    tp = topojson.Topology(data, prequantize=False)
    simplified = tp.toposimplify(tolerance, simplify_with="shapely")
    result = json.loads(simplified.to_geojson())

    normalize_geometries(result)
    normalize_ring_orientation(result)
    # Topology-preserving simplification can still collapse very short shared
    # borders into point contacts. Run the same cleanup once more so neighbors
    # end up with consistent line borders in the final output.
    fix_overlaps(result)
    realign_borders(result)
    normalize_ring_orientation(result)

    after = count_coordinates(result)
    reduction = (1 - after / before) * 100 if before > 0 else 0

    with open(output_path, "w") as f:
        json.dump(result, f)

    print(
        f"Features: {len(result['features'])} | "
        f"Coordinates: {before:,} -> {after:,} ({reduction:.1f}% reduction) | "
        f"Tolerance: {tolerance}"
    )


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <input.json> <output.json> [tolerance]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    tolerance = float(sys.argv[3]) if len(sys.argv) > 3 else 0.3

    simplify_geojson(input_path, output_path, tolerance)
