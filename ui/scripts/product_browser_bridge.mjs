import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

export async function startProductBrowserBridge({ directories, env, maxEntries = 128 }) {
    assert(process.platform === "linux", "Product browser bridge requires Linux");
    assert(Number.isSafeInteger(maxEntries) && maxEntries > 0 && maxEntries <= 10000);
    const control = await mkdtemp(path.join(os.tmpdir(), "catserver-browser-"));
    const socketPath = path.join(control, "open.sock");
    const launchers = [];
    const pages = [];
    const pageIds = new WeakMap();
    let launcherCount = 0;
    let pageCount = 0;
    let context;
    let server;
    let closed = false;
    let firstLaunchId;
    let resolveFirst;
    let rejectFirst;
    const first = new Promise((resolve, reject) => {
        resolveFirst = resolve;
        rejectFirst = reject;
    });
    // A failed navigation can precede the caller's wait.
    first.catch(() => {});
    const record = (entries, entry) => {
        if (entries.length === maxEntries) entries.shift();
        entries.push(entry);
    };
    const close = async () => {
        if (closed) return;
        closed = true;
        rejectFirst(new Error("Product browser bridge closed"));
        const errors = [];
        if (server?.listening) {
            try {
                await new Promise((resolve, reject) => {
                    server.closeAllConnections();
                    server.close(error => (error ? reject(error) : resolve()));
                });
            } catch (error) {
                errors.push(error);
            }
        }
        try {
            await context?.close();
        } catch (error) {
            errors.push(error);
        }
        try {
            await rm(control, { recursive: true, force: true });
        } catch (error) {
            errors.push(error);
        }
        if (errors.length) throw new AggregateError(errors, "Browser bridge shutdown failed");
    };
    try {
        const { chromium } = await import("@playwright/test");
        context = await chromium.launchPersistentContext(directories.browser, {
            headless: true,
            env,
        });
        const observe = (page, startup = false) => {
            const entry = { id: ++pageCount, url: page.url().slice(0, 2048), startup };
            pageIds.set(page, entry.id);
            record(pages, entry);
            page.on("framenavigated", frame => {
                if (frame === page.mainFrame()) entry.url = frame.url().slice(0, 2048);
            });
            page.on("close", () => {
                entry.closed = true;
            });
        };
        // Persistent Chromium starts with a blank tab, not a product page.
        for (const page of context.pages()) {
            observe(page, true);
            await page.close();
        }
        context.on("page", page => observe(page));
        server = http.createServer({ requestTimeout: 5000, maxHeaderSize: 4096 }, (req, res) => {
            let body = "";
            let size = 0;
            req.on("data", chunk => {
                size += chunk.length;
                if (size <= 8192) body += chunk.toString();
            });
            req.on("end", async () => {
                const entry = { id: ++launcherCount, arguments: [], status: "rejected" };
                record(launchers, entry);
                try {
                    assert(req.method === "POST" && req.url === "/open" && size <= 8192);
                    const payload = JSON.parse(body);
                    assert(Array.isArray(payload.args));
                    entry.arguments = payload.args
                        .slice(0, 8)
                        .map(arg => String(arg).slice(0, 256));
                    assert(!payload.oversized && payload.args.length === 1);
                    const target = payload.args[0];
                    assert(typeof target === "string" && target.length <= 2048);
                    assert(
                        /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:[0-9]+)?([/?#]|$)/.test(
                            target,
                        ) &&
                            !/[\s\\]/.test(target) &&
                            [...target].every(character => {
                                const code = character.charCodeAt(0);
                                return code >= 32 && code !== 127;
                            }),
                    );
                    const url = new URL(target);
                    assert(
                        url.protocol === "http:" &&
                            ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) &&
                            !url.username &&
                            !url.password,
                    );
                    assert(!closed, "Browser bridge is closed");
                    if (firstLaunchId === undefined) firstLaunchId = entry.id;
                    entry.status = "opening";
                    const page = await context.newPage();
                    entry.pageId = pageIds.get(page);
                    await page.goto(target, { waitUntil: "domcontentloaded", timeout: 15000 });
                    entry.status = "opened";
                    if (entry.id === firstLaunchId) resolveFirst(page);
                    res.writeHead(200).end();
                } catch (error) {
                    entry.error = String(error).slice(0, 2048);
                    if (entry.status === "opening") {
                        entry.status = "failed";
                        if (entry.id === firstLaunchId) rejectFirst(error);
                    }
                    res.writeHead(400).end();
                }
            });
        });
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(socketPath, resolve);
        });
        const bin = path.join(directories.root, "bin");
        await mkdir(bin);
        await writeFile(
            path.join(bin, "xdg-open"),
            `#!${process.execPath}
const http = require("node:http");
const args = process.argv.slice(2);
const oversized = args.length > 8 || args.some(arg => arg.length > 2048);
const body = JSON.stringify({ args: args.slice(0, 8).map(arg => arg.slice(0, 2048)), oversized });
const req = http.request({ socketPath: ${JSON.stringify(socketPath)}, path: "/open", method: "POST", headers: { "content-length": Buffer.byteLength(body) } }, res => {
    res.resume();
    res.on("end", () => { process.exitCode = res.statusCode === 200 ? 0 : 1; });
});
req.setTimeout(20000, () => req.destroy(new Error("Browser bridge timeout")));
req.on("error", () => { process.exitCode = 1; });
req.end(body);
`,
            { mode: 0o700 },
        );
        return {
            context,
            socketPath,
            env: { ...env, PATH: `${bin}${path.delimiter}${env.PATH || ""}` },
            evidence: () =>
                structuredClone({
                    launchers,
                    pages,
                    launcherCount,
                    pageCount,
                    droppedLaunchers: launcherCount - launchers.length,
                    droppedPages: pageCount - pages.length,
                }),
            waitForFirstPage: async (timeout = 15000) => {
                let timer;
                try {
                    return await Promise.race([
                        first,
                        new Promise((_, reject) => {
                            timer = setTimeout(
                                () => reject(new Error("No CATServer page opened")),
                                timeout,
                            );
                        }),
                    ]);
                } finally {
                    clearTimeout(timer);
                }
            },
            close,
        };
    } catch (error) {
        try {
            await close();
        } catch (closeError) {
            error.closeError = closeError;
        }
        throw error;
    }
}
