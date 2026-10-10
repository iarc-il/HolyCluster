import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const DIST_PATH = path.resolve("dist");
const ASSETS_PATH = path.join(DIST_PATH, "assets");
const MAX_CHUNK_BYTES = 500_000;
const MAX_INITIAL_CHUNKS = 10;
const MAX_INITIAL_GZIP_BYTES = 950_000;

const javascript_files = fs.readdirSync(ASSETS_PATH).filter(file => file.endsWith(".js"));
const oversized_chunks = javascript_files
    .map(file => ({ file, size: fs.statSync(path.join(ASSETS_PATH, file)).size }))
    .filter(({ size }) => size > MAX_CHUNK_BYTES);

const html = fs.readFileSync(path.join(DIST_PATH, "index.html"), "utf8");
const initial_chunks = new Set(
    Array.from(html.matchAll(/(?:src|href)="\/assets\/([^"?]+\.js)"/g), match => match[1]),
);
const initial_gzip_bytes = Array.from(initial_chunks).reduce(
    (total, file) => total + gzipSync(fs.readFileSync(path.join(ASSETS_PATH, file))).length,
    0,
);

const errors = [];
if (oversized_chunks.length) {
    errors.push(
        `Chunks over ${MAX_CHUNK_BYTES} bytes: ${oversized_chunks
            .map(({ file, size }) => `${file} (${size})`)
            .join(", ")}`,
    );
}
if (initial_chunks.size > MAX_INITIAL_CHUNKS) {
    errors.push(`Initial JavaScript chunks: ${initial_chunks.size} > ${MAX_INITIAL_CHUNKS}`);
}
if (initial_gzip_bytes > MAX_INITIAL_GZIP_BYTES) {
    errors.push(`Initial gzipped JavaScript: ${initial_gzip_bytes} > ${MAX_INITIAL_GZIP_BYTES}`);
}

if (errors.length) {
    throw new Error(errors.join("\n"));
}

console.log(
    `Build output: ${javascript_files.length} JavaScript chunks, ${initial_chunks.size} initial chunks, ${initial_gzip_bytes} initial gzip bytes`,
);
