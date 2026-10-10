import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const FLAGS_PATH = fileURLToPath(new URL("../src/assets/flags.json", import.meta.url));
const MODULE_ID = "virtual:flags";
const RESOLVED_ID = `\0${MODULE_ID}`;

export function flagsPlugin() {
    let is_build = false;
    return {
        name: "flags",
        configResolved(config) {
            is_build = config.command === "build";
        },
        resolveId(id) {
            return id === MODULE_ID ? RESOLVED_ID : null;
        },
        async load(id) {
            if (id !== RESOLVED_ID) return null;
            this.addWatchFile(FLAGS_PATH);
            const flags = JSON.parse(await fs.readFile(FLAGS_PATH, "utf8"));
            const entries = Object.entries(flags).map(([country, data]) => {
                const image = Buffer.from(data, "base64");
                const format = image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
                    ? "png"
                    : "webp";
                if (!is_build) {
                    return `${JSON.stringify(country)}: ${JSON.stringify(`data:image/${format};base64,${data}`)}`;
                }
                const reference = this.emitFile({
                    type: "asset",
                    name: `flag.${format}`,
                    source: image,
                });
                return `${JSON.stringify(country)}: import.meta.ROLLUP_FILE_URL_${reference}`;
            });
            return `export default {${entries.join(",")}};`;
        },
    };
}
