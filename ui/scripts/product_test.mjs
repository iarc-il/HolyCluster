import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { startProductBrowserBridge } from "./product_browser_bridge.mjs";

export function candidateRelease({ version, platform, architecture, name, bytes }) {
    for (const value of [version, platform, architecture, name]) {
        assert(typeof value === "string" && value.length > 0, "Supply candidate metadata");
    }
    assert(/^[A-Za-z0-9._-]+$/.test(name) && ![".", ".."].includes(name), "Invalid artifact name");
    assert(Buffer.isBuffer(bytes), "Supply candidate bytes");
    return {
        version,
        platform,
        architecture,
        artifact: {
            name,
            location: `/catserver/artifacts/${name}`,
            size: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
        },
    };
}

const contentTypes = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
};

export async function startProductBackend({
    dist = new URL("../dist/", import.meta.url),
    manifest,
    artifacts,
    maxRequests = 256,
    maxTargetBytes = 2048,
}) {
    assert(Number.isSafeInteger(maxRequests) && maxRequests > 0 && maxRequests <= 10000);
    assert(Number.isSafeInteger(maxTargetBytes) && maxTargetBytes > 0 && maxTargetBytes <= 8192);
    const root = await realpath(dist);
    const snapshot = JSON.stringify(manifest);
    assert(snapshot !== undefined, "Supply a release manifest");
    const candidates = new Map();
    for (const [location, bytes] of artifacts) {
        assert(
            /^\/catserver\/artifacts\/[A-Za-z0-9._-]+$/.test(location),
            "Invalid artifact location",
        );
        assert(Buffer.isBuffer(bytes), "Supply artifact bytes");
        // Copy the payload so later input changes cannot change a running test.
        candidates.set(location, Buffer.from(bytes));
    }
    const requests = [];
    let droppedRequests = 0;
    const server = http.createServer(
        { maxHeaderSize: 16384, requestTimeout: 5000 },
        async (request, response) => {
            const target = request.url;
            const entry = {
                method: request.method.slice(0, 16),
                path: Buffer.from(target).subarray(0, maxTargetBytes).toString("ascii"),
                status: 500,
            };
            if (requests.length === maxRequests) {
                requests.shift();
                droppedRequests++;
            }
            requests.push(entry);
            response.setHeader("Cache-Control", "no-store");
            const send = (status, body = "") => {
                entry.status = status;
                response.writeHead(status);
                response.end(body);
            };
            try {
                if (Buffer.byteLength(target) > maxTargetBytes) return send(414);
                if (
                    request.headers["transfer-encoding"] ||
                    Number(request.headers["content-length"]) > 0
                ) {
                    response.setHeader("Connection", "close");
                    return send(413);
                }
                if (request.method !== "GET") return send(405);
                let pathname;
                try {
                    pathname = decodeURIComponent(target.split("?")[0]);
                } catch {
                    return send(400);
                }
                // Check before URL normalization can remove traversal segments.
                if (
                    !pathname.startsWith("/") ||
                    pathname.includes("\\") ||
                    [...pathname].some(
                        character =>
                            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
                    ) ||
                    pathname.split("/").some(part => part === ".." || part === ".")
                ) {
                    return send(400);
                }
                if (pathname === "/catserver/releases/latest") {
                    response.setHeader("Content-Type", "application/json");
                    return send(200, snapshot);
                }
                if (candidates.has(pathname)) {
                    response.setHeader("Content-Type", "application/octet-stream");
                    return send(200, candidates.get(pathname));
                }
                if (pathname.startsWith("/catserver/") || pathname.startsWith("/api/"))
                    return send(404);
                let file;
                try {
                    file = await realpath(
                        path.join(root, pathname === "/" ? "index.html" : pathname),
                    );
                    const relative = path.relative(root, file);
                    if (
                        relative === ".." ||
                        relative.startsWith(`..${path.sep}`) ||
                        path.isAbsolute(relative)
                    )
                        return send(400);
                    if (!(await stat(file)).isFile()) return send(404);
                } catch (error) {
                    if (["ENOENT", "ENOTDIR"].includes(error.code)) return send(404);
                    throw error;
                }
                response.setHeader(
                    "Content-Type",
                    contentTypes[path.extname(file)] || "application/octet-stream",
                );
                entry.status = 200;
                response.writeHead(200);
                await pipeline(createReadStream(file), response);
            } catch {
                if (!response.headersSent) send(500);
                else response.destroy();
            }
        },
    );
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return {
        origin: `http://127.0.0.1:${server.address().port}`,
        evidence: () => ({ requests: structuredClone(requests), droppedRequests }),
        close: () =>
            new Promise((resolve, reject) => {
                server.closeAllConnections();
                server.close(error => (error ? reject(error) : resolve()));
            }),
    };
}

export async function withProductTest(options, run) {
    // Windows Known Folders do not use APPDATA overrides.
    assert(process.platform === "linux", "Product state isolation requires Linux");
    const root = await mkdtemp(
        path.join(options.temporaryParent || os.tmpdir(), "catserver-product-"),
    );
    const directories = { root };
    for (const name of ["home", "data", "config", "cache", "state", "browser", "evidence"]) {
        directories[name] = path.join(root, name);
        await mkdir(directories[name]);
    }
    const env = {
        ...process.env,
        HOME: directories.home,
        XDG_DATA_HOME: directories.data,
        XDG_CONFIG_HOME: directories.config,
        XDG_CACHE_HOME: directories.cache,
        XDG_STATE_HOME: directories.state,
    };
    let backend;
    let browserBridge;
    try {
        backend = await startProductBackend(options);
        if (options.browserBridge) {
            browserBridge = await startProductBrowserBridge({ directories, env });
        }
        const result = await run({
            directories,
            env: browserBridge?.env || env,
            backend,
            browserBridge,
        });
        await browserBridge?.close();
        await backend.close();
        backend = undefined;
        await rm(root, { recursive: true, force: true });
        return result;
    } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        const evidence = backend?.evidence() || { requests: [], droppedRequests: 0 };
        if (browserBridge) {
            try {
                await browserBridge.close();
            } catch (closeError) {
                evidence.browserCloseError = String(closeError).slice(0, 2048);
            }
            evidence.browser = browserBridge.evidence();
        }
        if (backend) {
            try {
                await backend.close();
            } catch (closeError) {
                evidence.closeError = String(closeError).slice(0, 2048);
            }
        }
        error.evidenceDirectory = directories.evidence;
        try {
            await writeFile(
                path.join(directories.evidence, "failure.json"),
                JSON.stringify(
                    { ...evidence, error: String(error.stack || error).slice(0, 16384) },
                    null,
                    2,
                ),
            );
        } catch (evidenceWriteError) {
            error.evidenceWriteError = evidenceWriteError;
        }
        throw error;
    }
}
