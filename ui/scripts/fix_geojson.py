#!/usr/bin/env python3
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


def fix_geojson(input_path, output_path):
    with open(input_path) as f:
        data = json.load(f)

    features = data["features"]
    fixed_validity = 0
    fixed_winding = 0

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

    with open(output_path, "w") as f:
        json.dump(data, f)

    all_valid = all(shape(f["geometry"]).is_valid for f in data["features"])
    print(f"\nFixed {fixed_validity} validity issue(s), {fixed_winding} winding order fix(es). All valid: {all_valid}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.json> <output.json>")
        sys.exit(1)
    fix_geojson(sys.argv[1], sys.argv[2])
