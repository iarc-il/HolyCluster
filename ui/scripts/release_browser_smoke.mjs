// Exercise the installed CATServer without contacting the production backend or executing a download.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium, firefox } from "@playwright/test";

const executable = process.env.CATSERVER_SMOKE_EXE;
const version = process.env.CATSERVER_SMOKE_VERSION;
assert(executable && version, "Set CATSERVER_SMOKE_EXE and CATSERVER_SMOKE_VERSION");
const windows = await readFile(process.env.CATSERVER_SMOKE_MSI);
const linux = await readFile(process.env.CATSERVER_SMOKE_APPIMAGE);
const helper = await readFile(new URL("../src/utils/release_download.js", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const artifact = (platform, bytes) => {
    const name = `${version}-${platform}-x86_64${platform === "windows" ? ".msi" : ".AppImage"}`;
    return {
        version,
        platform,
        architecture: "x86_64",
        artifact: {
            name,
            location: `/catserver/artifacts/${name}`,
            size: bytes.length,
            sha256: digest(bytes),
        },
    };
};
const goodWindows = artifact("windows", windows);
const location = goodWindows.artifact.location;
let swapped = false;
const backend = http.createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/catserver/releases/latest") {
        response.setHeader("Content-Type", "application/json");
        response.end(
            JSON.stringify({
                schema_version: 1,
                releases: [
                    artifact("windows", swapped ? linux : windows),
                    artifact("linux", linux),
                ],
            }),
        );
    } else if (pathname === location) {
        response.end(swapped ? linux : windows);
    } else if (pathname === artifact("linux", linux).artifact.location) {
        response.end(linux);
    } else if (pathname === "/release_download.js") {
        response.setHeader("Content-Type", "text/javascript");
        response.end(helper);
    } else {
        response.setHeader("Content-Type", "text/html");
        response.end(`<a id="download-windows">Download MSI</a><a id="download-linux">Download AppImage</a><script type="module">
            import { release_download_url } from '/release_download.js';
            const response = await fetch('/catserver/releases/latest', { cache: 'no-store' });
            const manifest = await response.json();
            for (const platform of ['windows', 'linux']) {
                document.querySelector('#download-' + platform).href = release_download_url(
                    manifest.releases.find(release => release.platform === platform), platform,
                    response.headers.get('x-catserver-upstream') || window.location.origin);
            }
        </script>`);
    }
});
const listen = server =>
    new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    });
const close = server =>
    new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close(error => (error ? reject(error) : resolve()));
    });
const seed = http.createServer((request, response) => {
    if (request.url === location || request.url === "/catserver/download") {
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        response.end(linux);
    } else {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "text/html");
        response.end("<!doctype html><title>Isolated cache seed</title>");
    }
});
const temporary = await mkdtemp(path.join(os.tmpdir(), "holy-release-smoke-"));
const contexts = [];
let native;
let nativeError;
let output = "";
let seedClosed = false;
try {
    const backendPort = await listen(backend);
    const port = await listen(seed);
    const origin = `http://127.0.0.1:${port}`;
    const browserDigest = async (page, url) =>
        page.evaluate(async url => {
            const data = await (await fetch(url)).arrayBuffer();
            return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
                .map(byte => byte.toString(16).padStart(2, "0"))
                .join("");
        }, url);
    for (const [name, browser] of [
        [process.platform === "win32" ? "edge" : "chromium", chromium],
        ["firefox", firefox],
    ]) {
        const context = await browser.launchPersistentContext(path.join(temporary, name), {
            headless: true,
            acceptDownloads: true,
            ...(name === "edge" ? { channel: "msedge" } : {}),
        });
        contexts.push({ name, context, page: await context.newPage() });
        const { page } = contexts.at(-1);
        await page.goto(origin);
        for (const oldPath of [location, "/catserver/download"]) {
            assert.equal(await browserDigest(page, origin + oldPath), digest(linux));
        }
    }
    await close(seed);
    seedClosed = true;
    // Prove these are real retained HTTP cache entries with no server listening.
    for (const { name, page } of contexts) {
        assert.equal(
            await browserDigest(page, origin + location),
            digest(linux),
            `${name} did not retain the seeded entry`,
        );
    }
    native = spawn(
        executable,
        [
            "--dummy",
            "--dummy-rotator",
            "--backend",
            `127.0.0.1:${backendPort}`,
            "--port",
            String(port),
        ],
        {
            windowsHide: true,
            env: {
                ...process.env,
                XDG_DATA_HOME: path.join(temporary, "data"),
                XDG_CONFIG_HOME: path.join(temporary, "configuration"),
                XDG_CACHE_HOME: path.join(temporary, "cache"),
                APPDATA: path.join(temporary, "configuration"),
                LOCALAPPDATA: path.join(temporary, "data"),
                HOME: temporary,
                ...(process.platform === "win32" ? {} : { BROWSER: "true" }),
            },
        },
    );
    native.on("error", error => {
        nativeError = error;
    });
    for (const stream of [native.stdout, native.stderr])
        stream?.on("data", data => {
            output = (output + data).slice(-200000);
        });
    let ready = false;
    for (const deadline = Date.now() + 60000; Date.now() < deadline; ) {
        if (nativeError) throw nativeError;
        assert.equal(native.exitCode, null, `CATServer exited: ${output}`);
        try {
            const response = await fetch(`${origin}/api/ready`, {
                signal: AbortSignal.timeout(1000),
            });
            if (response.ok) {
                const status = await response.json();
                assert.equal(typeof status.instance_id, "string");
                assert.equal(typeof status.version, "string");
                if (process.env.CATSERVER_SMOKE_EXPECT_VERSION) {
                    assert.equal(status.version, process.env.CATSERVER_SMOKE_EXPECT_VERSION);
                }
                console.log(
                    JSON.stringify({
                        nativeVersion: status.version,
                        release: version,
                        windowsSha256: digest(windows),
                        linuxSha256: digest(linux),
                    }),
                );
                ready = true;
                break;
            }
        } catch (error) {
            if (error.code === "ERR_ASSERTION") throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(ready, `CATServer readiness timed out: ${output}`);
    for (const { name, page } of contexts) {
        swapped = false;
        await page.goto(origin);
        let windowsUrl;
        for (const [platform, bytes, extension] of [
            ["windows", windows, ".msi"],
            ["linux", linux, ".AppImage"],
        ]) {
            const selector = `#download-${platform}`;
            await page.waitForSelector(`${selector}[href]`);
            const href = await page.locator(selector).getAttribute("href");
            const url = new URL(href, origin);
            if (platform === "windows") windowsUrl = url;
            assert.equal(url.searchParams.get("download_policy"), "2");
            assert.equal(url.searchParams.get("sha256"), digest(bytes));
            assert.equal(
                url.searchParams.get("upstream"),
                digest(`http://127.0.0.1:${backendPort}/`),
            );
            const [download] = await Promise.all([
                page.waitForEvent("download"),
                page.click(selector),
            ]);
            assert.equal(await download.failure(), null);
            assert(download.suggestedFilename().endsWith(extension));
            const saved = path.join(temporary, `${name}${extension}`);
            await download.saveAs(saved);
            assert.equal(digest(await readFile(saved)), digest(bytes));
        }
        swapped = true;
        // Match the manifest's size/hash to the deliberately wrong bytes. Format
        // inspection, rather than the checksum, must reject this response.
        const bad = new URL(windowsUrl);
        bad.searchParams.set("sha256", digest(linux));
        const rejected = await page.evaluate(async url => {
            const response = await fetch(url);
            return {
                status: response.status,
                cache: response.headers.get("cache-control"),
                body: await response.text(),
            };
        }, bad.toString());
        assert.equal(rejected.status, 502);
        assert.equal(rejected.cache, "no-store");
        assert.equal(rejected.body, "Release package unavailable");
        console.log(
            `${name}: retained AppImage cache bypassed; saved MSI/AppImage hashes verified; swapped bytes rejected`,
        );
    }
} finally {
    for (const { context } of contexts) await context.close();
    if (native && native.exitCode === null) {
        native.kill();
        await new Promise(resolve => {
            native.once("exit", resolve);
            setTimeout(resolve, 5000).unref();
        });
    }
    if (!seedClosed) await close(seed).catch(() => {});
    await close(backend).catch(() => {});
    await rm(temporary, { recursive: true, force: true });
}
