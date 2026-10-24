import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { startProductBrowserBridge } from "./product_browser_bridge.mjs";
import { withProductTest } from "./product_test.mjs";

const exec = promisify(execFile);
const linux = { skip: process.platform !== "linux" };

async function fixture(t) {
    const root = await mkdtemp(path.join(os.tmpdir(), "browser-bridge-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const dist = path.join(root, "dist");
    await mkdir(dist);
    await writeFile(path.join(dist, "index.html"), "<title>Bridge product</title>");
    return { dist, manifest: {}, artifacts: new Map(), temporaryParent: root, browserBridge: true };
}

// The shell resolves xdg-open through the same PATH that CATServer receives.
function launch(env, ...args) {
    return exec("/bin/sh", ["-c", 'exec xdg-open "$@"', "bridge-child", ...args], { env });
}

test("real launcher opens one page per call and shutdown releases resources", linux, async t => {
    const options = await fixture(t);
    let bridge;
    await withProductTest(options, async ({ browserBridge, env, backend }) => {
        bridge = browserBridge;
        assert.equal(bridge.context.pages().length, 0);
        const startup = bridge.evidence();
        assert.equal(startup.pageCount, 1);
        assert.equal(startup.pages[0].startup, true);
        assert.equal(startup.pages[0].closed, true);
        const waiting = bridge.waitForFirstPage();
        const target = `${backend.origin}/?requested=first`;
        await launch(env, target);
        const first = await waiting;
        assert.equal(first.url(), target);
        assert.equal(await first.title(), "Bridge product");
        const beforeUpdate = bridge.evidence();
        assert.equal(beforeUpdate.launcherCount, 1);
        assert.equal(beforeUpdate.pageCount - startup.pageCount, 1);
        assert.equal(beforeUpdate.launchers[0].status, "opened");
        assert.deepEqual(beforeUpdate.launchers[0].arguments, [target]);
        assert.equal(beforeUpdate.pages[1].url, target);
        assert.equal(beforeUpdate.launchers[0].pageId, beforeUpdate.pages[1].id);
        assert.equal(bridge.context.pages().length, 1);

        await launch(env, `${backend.origin}/?requested=second`);
        await bridge.context
            .pages()
            .at(-1)
            .waitForURL(`${backend.origin}/?requested=second`, { waitUntil: "domcontentloaded" });
        const afterUpdate = bridge.evidence();
        assert.equal(afterUpdate.launcherCount - beforeUpdate.launcherCount, 1);
        assert.equal(afterUpdate.pageCount - beforeUpdate.pageCount, 1);
        assert.equal(bridge.context.pages().length, 2);
        assert.equal(await bridge.waitForFirstPage(), first);
        assert.equal(afterUpdate.pages[2].url, `${backend.origin}/?requested=second`);
        // Observe pages not made by the launcher, such as a product popup.
        await bridge.context.newPage();
        assert.equal(bridge.evidence().pageCount, 4);
    });
    assert.equal(bridge.context.pages().length, 0);
    await assert.rejects(bridge.context.newPage());
    await assert.rejects(stat(bridge.socketPath), { code: "ENOENT" });
    await bridge.close();
});

test("launcher returns before CATServer starts serving HTTP", linux, async t => {
    const options = await fixture(t);
    await withProductTest(options, async ({ browserBridge: bridge, env }) => {
        let serving = false;
        const server = http.createServer((_request, response) => {
            if (serving) response.end("<title>After launcher</title>");
            else server.once("serving", () => response.end("<title>After launcher</title>"));
        });
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        try {
            await launch(env, `http://127.0.0.1:${server.address().port}/`);
            serving = true;
            server.emit("serving");
            const page = await bridge.waitForFirstPage();
            assert.equal(await page.title(), "After launcher");
        } finally {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
    });
});

test("reject invalid URLs and bound launcher evidence", linux, async t => {
    const options = await fixture(t);
    await withProductTest(options, async ({ browserBridge: bridge, env }) => {
        await assert.rejects(bridge.waitForFirstPage(10), /No CATServer page opened/);
        for (const args of [
            [],
            ["not-a-url"],
            ["http://["],
            ["http:///127.0.0.1/"],
            ["http://127.0.0.1\\path"],
            ["https://127.0.0.1/"],
            ["http://example.com/"],
            ["file:///etc/passwd"],
            ["http://127.0.0.1@example.com/"],
            ["http://user@127.0.0.1/"],
            ["http://127.0.0.1/\n"],
            ["http://127.0.0.1/", "extra"],
            [`http://127.0.0.1/${"x".repeat(50000)}`],
        ]) {
            await assert.rejects(launch(env, ...args));
        }
        const rejected = bridge.evidence();
        assert(rejected.launchers.every(entry => JSON.stringify(entry).length < 4096));
        assert.equal(rejected.launchers.at(-1).arguments[0].length, 256);
        // Repeated rejected launches cannot grow the evidence without limit.
        await Promise.all(Array.from({ length: 130 }, () => assert.rejects(launch(env, "bad"))));
        const evidence = bridge.evidence();
        assert.equal(evidence.launcherCount, 143);
        assert.equal(evidence.launchers.length, 128);
        assert.equal(evidence.droppedLaunchers, 15);
        assert.equal(evidence.pageCount, 1);
        assert(evidence.pages.every(page => page.startup));
        assert.equal(bridge.context.pages().length, 0);
        assert(evidence.launchers.every(entry => entry.status === "rejected"));
        assert(evidence.launchers.every(entry => JSON.stringify(entry).length < 4096));
        evidence.launchers[0].status = "changed";
        assert.equal(bridge.evidence().launchers[0].status, "rejected");
    });
});

test("retain browser evidence and the primary product error", linux, async t => {
    const options = await fixture(t);
    const primary = new Error("product failed after launch");
    let bridge;
    await assert.rejects(
        withProductTest(options, async ({ browserBridge, env, backend }) => {
            bridge = browserBridge;
            await launch(env, backend.origin);
            await bridge.waitForFirstPage();
            throw primary;
        }),
        error => error === primary,
    );
    const evidence = JSON.parse(
        await readFile(path.join(primary.evidenceDirectory, "failure.json"), "utf8"),
    );
    assert.equal(evidence.browser.launcherCount, 1);
    assert.equal(evidence.browser.pageCount, 2);
    assert(evidence.browser.pages.every(page => page.closed));
    assert.match(evidence.error, /product failed after launch/);
    await assert.rejects(stat(bridge.socketPath), { code: "ENOENT" });
    await assert.rejects(bridge.context.newPage());
});

test("bound all page evidence without losing total counts", linux, async t => {
    const options = await fixture(t);
    options.browserBridge = false;
    await withProductTest(options, async ({ directories, env, backend }) => {
        const bridge = await startProductBrowserBridge({ directories, env, maxEntries: 2 });
        try {
            await launch(bridge.env, backend.origin);
            await launch(bridge.env, `${backend.origin}/?second`);
            await bridge.context
                .pages()
                .at(-1)
                .waitForURL(`${backend.origin}/?second`, { waitUntil: "domcontentloaded" });
            await bridge.context.newPage();
            const evidence = bridge.evidence();
            assert.equal(evidence.pageCount, 4);
            assert.equal(evidence.pages.length, 2);
            assert.equal(evidence.droppedPages, 2);
            assert.equal(evidence.launcherCount, 2);
            assert.equal(evidence.pages[0].url, `${backend.origin}/?second`);
        } finally {
            await bridge.close();
        }
    });
});

test("report a failed first navigation instead of waiting for another launch", linux, async t => {
    const options = await fixture(t);
    await withProductTest(options, async ({ browserBridge: bridge, env, backend }) => {
        await bridge.context.route("**/*", route => route.abort());
        await launch(env, backend.origin);
        await assert.rejects(bridge.waitForFirstPage(), /net::ERR_FAILED/);
        assert.equal(bridge.evidence().launchers[0].status, "failed");
        assert.equal(bridge.evidence().pageCount, 2);
    });
});

test("reject WSL before state, callback, or browser creation", linux, async t => {
    const options = await fixture(t);
    const bridgeUrl = new URL("./product_browser_bridge.mjs", import.meta.url).href;
    const harnessUrl = new URL("./product_test.mjs", import.meta.url).href;
    for (const signal of [
        "release",
        "version",
        "proc",
        "WSL_DISTRO_NAME",
        "WSL_INTEROP",
        "childEnv",
    ]) {
        execFileSync(
            process.execPath,
            [
                "--input-type=module",
                "--eval",
                `
            import assert from "node:assert/strict";
            import fs from "node:fs";
            import os from "node:os";
            import { syncBuiltinESMExports } from "node:module";
            import { chromium } from "@playwright/test";
            const signal = ${JSON.stringify(signal)};
            delete process.env.WSL_DISTRO_NAME;
            delete process.env.WSL_INTEROP;
            os.release = () => signal === "release" ? "5.15.0-microsoft-standard-WSL2" : "6.1.0";
            os.version = () => signal === "version" ? "Microsoft Linux" : "Linux";
            const readFileSync = fs.readFileSync;
            fs.readFileSync = (file, ...args) => file === "/proc/version"
                ? (signal === "proc" ? "Linux version 4.4.0-Microsoft" : "Linux version 6.1.0")
                : readFileSync(file, ...args);
            if (signal === "WSL_DISTRO_NAME" || signal === "WSL_INTEROP") process.env[signal] = "test";
            syncBuiltinESMExports();
            chromium.launchPersistentContext = () => assert.fail("Must not create a browser");
            const { startProductBrowserBridge } = await import(${JSON.stringify(bridgeUrl)});
            const { withProductTest } = await import(${JSON.stringify(harnessUrl)});
            const root = ${JSON.stringify(options.temporaryParent)};
            const before = fs.readdirSync(root);
            await assert.rejects(startProductBrowserBridge({
                directories: { root, browser: root },
                env: signal === "childEnv" ? { ...process.env, WSL_INTEROP: "test" } : process.env,
            }), /does not support WSL/);
            if (signal !== "childEnv") {
                await assert.rejects(withProductTest({ browserBridge: true, temporaryParent: root },
                    () => assert.fail("Must not call the product callback")), /does not support WSL/);
            }
            assert.deepEqual(fs.readdirSync(root), before);
            `,
            ],
            { cwd: new URL("../", import.meta.url) },
        );
    }
});

test("browser bridge fails closed on other platforms", async () => {
    const moduleUrl = new URL("./product_browser_bridge.mjs", import.meta.url).href;
    for (const platform of ["darwin", "win32"]) {
        execFileSync(process.execPath, [
            "--input-type=module",
            "--eval",
            `
            import assert from "node:assert/strict";
            import { startProductBrowserBridge } from ${JSON.stringify(moduleUrl)};
            Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} });
            await assert.rejects(startProductBrowserBridge({}), /requires Linux/);
            `,
        ]);
    }
});
