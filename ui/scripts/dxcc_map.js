import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DXCC_MAP_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/maps/dxcc_map.json",
);
const PART_TARGET_BYTES = 400_000;
const VIRTUAL_DXCC_MAP_MODULE_ID = "virtual:dxcc-map";
const VIRTUAL_DXCC_MAP_PART_PREFIX = "virtual:dxcc-map-part/";

function split_features(features) {
    const parts = [[]];
    let part_size = 0;

    for (const feature of features) {
        const feature_size = JSON.stringify(feature).length;
        if (part_size && part_size + feature_size > PART_TARGET_BYTES) {
            parts.push([]);
            part_size = 0;
        }
        parts.at(-1).push(feature);
        part_size += feature_size;
    }

    return parts;
}

export function dxccMapChunkName(id) {
    const marker = `\0${VIRTUAL_DXCC_MAP_PART_PREFIX}`;
    if (!id.startsWith(marker)) return null;
    return `dxcc-${id.slice(marker.length)}`;
}

export function dxccMapPlugin() {
    const resolved_module_id = `\0${VIRTUAL_DXCC_MAP_MODULE_ID}`;
    const resolved_part_prefix = `\0${VIRTUAL_DXCC_MAP_PART_PREFIX}`;
    let map_data;
    let feature_parts;

    async function load_map() {
        if (!map_data) {
            map_data = JSON.parse(await fs.readFile(DXCC_MAP_PATH, "utf8"));
            feature_parts = split_features(map_data.features);
        }
    }

    return {
        name: "dxcc-map",
        resolveId(id) {
            if (id === VIRTUAL_DXCC_MAP_MODULE_ID) return resolved_module_id;
            if (id.startsWith(VIRTUAL_DXCC_MAP_PART_PREFIX)) return `\0${id}`;
            return null;
        },
        async load(id) {
            if (id !== resolved_module_id && !id.startsWith(resolved_part_prefix)) return null;

            await load_map();
            this.addWatchFile(DXCC_MAP_PATH);

            if (id.startsWith(resolved_part_prefix)) {
                const part_index = Number(id.slice(resolved_part_prefix.length));
                return `export default ${JSON.stringify(feature_parts[part_index])};`;
            }

            const { features: _features, ...metadata } = map_data;
            const imports = feature_parts.map(
                (_, index) =>
                    `import features_${index} from "${VIRTUAL_DXCC_MAP_PART_PREFIX}${index}";`,
            );
            const feature_names = feature_parts.map((_, index) => `...features_${index}`);
            return [
                ...imports,
                `export default { ...${JSON.stringify(metadata)}, features: [${feature_names.join(",")}] };`,
                "",
            ].join("\n");
        },
    };
}
