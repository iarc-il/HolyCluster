#!/usr/bin/env python3
"""Fix GeoJSON geometries that cause d3.js rendering issues (spilling).

Handles:
- Authoritative replacement: replaces oversimplified DXCC polygons with
  more detailed ones from an authoritative map (via spatial overlap matching)
- Holes that lie outside their shell (promoted to separate polygons)
- Self-intersecting polygons (resolved via buffer(0))
- Winding order: enforces CW exterior / CCW holes (d3-geo clockwise convention)
- Antarctic polar stitch: removes ring segments passing through the south pole
  that cause spilling when the map is centered on the north pole

Usage:
    python fix_geojson.py <input.json> <output.json> [authoritative.json]
"""
import json
import sys
from shapely.geometry import shape, mapping, MultiPolygon, Polygon
from shapely.geometry.polygon import orient
from shapely.validation import explain_validity

AREA_RATIO_THRESHOLD = 5.0


def norm_name(s):
    if not s:
        return ""
    return "".join(ch.lower() for ch in str(s) if ch.isalnum())


def build_auth_name_index(auth_features):
    idx = {}
    for i, feat in enumerate(auth_features):
        p = feat.get("properties", {})
        candidates = [
            p.get("name"),
            p.get("name_en"),
            p.get("name_long"),
            p.get("admin"),
            p.get("formal_en"),
        ]
        for c in candidates:
            n = norm_name(c)
            if n:
                idx.setdefault(n, []).append(i)
    return idx


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


def replace_with_authoritative(data, auth_path):
    """Replace oversimplified DXCC polygons using an authoritative map.

    For each authoritative feature, find which DXCC feature contains its
    centroid. Group authoritative features by DXCC feature index. If the
    DXCC feature's area is much larger than the total authoritative area,
    replace it with the union of the authoritative features.
    """
    with open(auth_path) as f:
        auth_data = json.load(f)

    auth_features = auth_data["features"]
    auth_shapes = [shape(feat["geometry"]) for feat in auth_features]
    auth_name_idx = build_auth_name_index(auth_features)

    dxcc_shapes = [shape(feat["geometry"]) for feat in data["features"]]
    dxcc_names = [feat["properties"].get("dxcc_name", "") for feat in data["features"]]

    auth_groups = {}

    # Pass 1: direct name matching (safest)
    for di, dxcc_name in enumerate(dxcc_names):
        key = norm_name(dxcc_name)
        if key in auth_name_idx:
            auth_groups[di] = [auth_shapes[i] for i in auth_name_idx[key]]

    # Pass 2: spatial fallback for unmatched DXCC features
    for ai, auth_s in enumerate(auth_shapes):
        centroid = auth_s.centroid
        matched = False
        for grouped in auth_groups.values():
            if auth_s in grouped:
                matched = True
                break
        if matched:
            continue
        for di, ds in enumerate(dxcc_shapes):
            if di in auth_groups:
                continue
            if ds.contains(centroid):
                auth_groups.setdefault(di, []).append(auth_s)
                break

    replaced = 0
    for di, auth_shapes in auth_groups.items():
        ds = dxcc_shapes[di]
        if not ds.is_valid:
            ds = ds.buffer(0)
        auth_union = auth_shapes[0]
        for a in auth_shapes[1:]:
            auth_union = auth_union.union(a)
        if not auth_union.is_valid:
            auth_union = auth_union.buffer(0)
        if auth_union.is_empty or auth_union.area == 0:
            continue

        # Guard against obvious mismatches (e.g. France -> Monaco)
        overlap_ratio = ds.intersection(auth_union).area / auth_union.area
        if overlap_ratio < 0.5:
            continue

        if ds.area > auth_union.area * AREA_RATIO_THRESHOLD:
            name = dxcc_names[di]
            print(f"Replacing feature {di} ({name}): "
                  f"area {ds.area:.1f} -> {auth_union.area:.1f} "
                  f"(ratio {ds.area / auth_union.area:.1f}x)")
            new_geom = mapping(auth_union)
            data["features"][di]["geometry"] = new_geom
            dxcc_shapes[di] = auth_union
            replaced += 1

    return replaced


def fix_geojson(input_path, output_path, auth_path=None):
    with open(input_path) as f:
        data = json.load(f)

    features = data["features"]
    fixed_authoritative = 0
    fixed_validity = 0
    fixed_winding = 0
    fixed_stitch = 0

    if auth_path:
        fixed_authoritative = replace_with_authoritative(data, auth_path)

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
    summary = f"{fixed_authoritative} authoritative replacement(s), {fixed_validity} validity issue(s), {fixed_winding} winding order fix(es), {fixed_stitch} antarctic stitch(es)"
    if all_valid:
        print(f"\nFixed {summary}. All valid: {all_valid}")
    else:
        print(f"\nFixed {summary}.")
        print("Note: stitched antarctic polygon has expected self-intersection at antimeridian (harmless for d3-geo rendering)")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <input.json> <output.json> [authoritative.json]")
        sys.exit(1)
    auth_path = sys.argv[3] if len(sys.argv) > 3 else None
    fix_geojson(sys.argv[1], sys.argv[2], auth_path)
