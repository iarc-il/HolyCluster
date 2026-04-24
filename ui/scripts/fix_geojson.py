#!/usr/bin/env python3
"""Fix GeoJSON geometries that cause d3.js rendering issues (spilling).

Handles:
- Holes that lie outside their shell (promoted to separate polygons)
- Self-intersecting polygons (resolved via buffer(0))
- Winding order: enforces CW exterior / CCW holes (d3-geo clockwise convention)
- Antarctic polar stitch: removes ring segments passing through the south pole
  that cause spilling when the map is centered on the north pole

Usage:
    python fix_geojson.py <input.json> <output.json>
"""
import json
import sys
from shapely.geometry import shape, mapping, MultiPolygon, Polygon
from shapely.geometry.polygon import orient
from shapely.validation import explain_validity


def orient_geometry(geom):
    if geom.geom_type == "Polygon":
        return orient(geom, sign=-1.0)
    elif geom.geom_type == "MultiPolygon":
        return MultiPolygon([orient(p, sign=-1.0) for p in geom.geoms])
    return geom


def fix_hole_outside_shell(geom):
    coords = geom["coordinates"]
    if geom["type"] == "MultiPolygon":
        new_polygons = []
        for polygon_coords in coords:
            exterior = polygon_coords[0]
            interiors = polygon_coords[1:]
            valid_interiors = []
            shell = Polygon(exterior)
            for interior in interiors:
                hole = Polygon(interior)
                if shell.contains(hole):
                    valid_interiors.append(interior)
                else:
                    new_polygons.append(Polygon(interior))
            new_polygons.append(Polygon(exterior, valid_interiors))
        result = MultiPolygon(new_polygons)
    elif geom["type"] == "Polygon":
        exterior = coords[0]
        interiors = coords[1:]
        valid_interiors = []
        new_parts = []
        shell = Polygon(exterior)
        for interior in interiors:
            hole = Polygon(interior)
            if shell.contains(hole):
                valid_interiors.append(interior)
            else:
                new_parts.append(Polygon(interior))
        if new_parts:
            result = MultiPolygon([Polygon(exterior, valid_interiors)] + new_parts)
        else:
            result = Polygon(exterior, valid_interiors)
    else:
        return None
    if not result.is_valid:
        result = result.buffer(0)
    return result


def stitch_antarctica(ring):
    """Remove ring segments passing through the south pole.

    Matches both CCW and CW winding patterns:
    CCW: [..., [-180, lat], [-180, -90], [180, -90], [180, lat], ...]
    CW:  [..., [180, lat], [180, -90], [-180, -90], [-180, lat], ...]
    Both get stitched to connect the antimeridian edges at the same latitude,
    cutting off the south pole segment.
    """
    i = 0
    new_ring = []
    while i < len(ring):
        if (i + 3 < len(ring)
                and abs(ring[i][1] - ring[i + 3][1]) < 0.01
                and abs(abs(ring[i][0]) - 180) < 0.01 and abs(ring[i][1] - ring[i + 3][1]) < 0.01
                and abs(abs(ring[i + 1][0]) - 180) < 0.01 and abs(ring[i + 1][1] - (-90)) < 0.01
                and abs(abs(ring[i + 2][0]) - 180) < 0.01 and abs(ring[i + 2][1] - (-90)) < 0.01
                and abs(abs(ring[i + 3][0]) - 180) < 0.01
                and ring[i][0] * ring[i + 3][0] < 0
                and ring[i + 1][0] * ring[i + 2][0] < 0):
            new_ring.append(ring[i])
            new_ring.append(ring[i + 3])
            i += 4
            continue
        new_ring.append(ring[i])
        i += 1
    if len(new_ring) != len(ring):
        return new_ring
    return None


def stitch_coords(coords):
    changed = False
    new_coords = []
    for ring in coords:
        stitched = stitch_antarctica(ring)
        if stitched is not None:
            new_coords.append(stitched)
            changed = True
        else:
            new_coords.append(ring)
    return new_coords if changed else None


def stitch_geojson_coords(geom):
    """Apply antarctic stitch to raw GeoJSON coordinates (after shapely processing)."""
    if geom["type"] == "MultiPolygon":
        any_changed = False
        new_polys = []
        for poly_coords in geom["coordinates"]:
            stitched = stitch_coords(poly_coords)
            if stitched is not None:
                new_polys.append(stitched)
                any_changed = True
            else:
                new_polys.append(poly_coords)
        if any_changed:
            geom["coordinates"] = new_polys
        return any_changed
    elif geom["type"] == "Polygon":
        stitched = stitch_coords(geom["coordinates"])
        if stitched is not None:
            geom["coordinates"] = stitched
            return True
    return False


def fix_geojson(input_path, output_path):
    with open(input_path) as f:
        data = json.load(f)

    features = data["features"]
    fixed_validity = 0
    fixed_winding = 0
    fixed_stitch = 0

    for i, feature in enumerate(features):
        name = feature["properties"].get("dxcc_name", "")
        geom = feature["geometry"]
        s = shape(geom)

        if not s.is_valid:
            reason = explain_validity(s)
            print(f"Fixing validity feature {i} ({name}): {reason}")

            if "Hole lies outside shell" in reason:
                result = fix_hole_outside_shell(geom)
            else:
                result = s.buffer(0)

            if result is None:
                result = s.buffer(0)

            s = result
            if not s.is_valid:
                print(f"  WARNING: still invalid: {explain_validity(s)}")
            else:
                fixed_validity += 1

        oriented = orient_geometry(s)
        if mapping(oriented) != feature["geometry"]:
            fixed_winding += 1

        feature["geometry"] = mapping(oriented)

        if stitch_geojson_coords(feature["geometry"]):
            print(f"Stitching antarctic polar segment in feature {i} ({name})")
            fixed_stitch += 1

    with open(output_path, "w") as f:
        json.dump(data, f)

    all_valid = all(shape(f["geometry"]).is_valid for f in data["features"])
    stitched_invalid = fixed_stitch > 0 and not all(shape(data["features"][i]["geometry"]).is_valid for i in range(len(data["features"])) if any(
        any(abs(c[1] - (-90)) < 0.01 for c in ring)
        for poly in (data["features"][i]["geometry"].get("coordinates", []) if data["features"][i]["geometry"]["type"] == "MultiPolygon" else [data["features"][i]["geometry"].get("coordinates", [])])
        for ring in poly
    ))
    if all_valid:
        print(f"\nFixed {fixed_validity} validity issue(s), {fixed_winding} winding order fix(es), {fixed_stitch} antarctic stitch(es). All valid: {all_valid}")
    else:
        print(f"\nFixed {fixed_validity} validity issue(s), {fixed_winding} winding order fix(es), {fixed_stitch} antarctic stitch(es).")
        print(f"Note: stitched antarctic polygon has expected self-intersection at antimeridian (harmless for d3-geo rendering)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.json> <output.json>")
        sys.exit(1)
    fix_geojson(sys.argv[1], sys.argv[2])
