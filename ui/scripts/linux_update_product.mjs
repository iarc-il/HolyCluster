import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { candidateRelease, withProductTest } from "./product_test.mjs";

export const UPDATE_BOUND_MS = 55000;
export const PRODUCT_PORT = 41234;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

export function readyVersion(version) {
    return version.replace(/^catserver-v/, "").replace(/-g[0-9a-f]+$/, "");
}

export function listeningInodes(text, port) {
    return text
        .trim()
        .split("\n")
        .slice(1)
        .map(line => line.trim().split(/\s+/))
        .filter(
            fields => Number.parseInt(fields[1].split(":")[1], 16) === port && fields[3] === "0A",
        )
        .map(fields => fields[9]);
}

export function assertSinglePage(evidence) {
    assert.equal(evidence.launcherCount, 1, "CATServer opened an extra browser page");
    assert.equal(evidence.pages.filter(page => !page.startup).length, 1, "Extra product page");
}

export function assertConfiguration(response, expected) {
    const { version, type, event, ...configuration } = response;
    assert.equal(version, 1);
    assert.deepEqual(configuration, expected, `${type} configuration differs`);
}

export function assertNormalRelaunch(evidence) {
    assert.equal(evidence.launcherCount, 2, "Normal start must open exactly one new page");
    const pages = evidence.pages.filter(page => !page.startup);
    assert.equal(pages.length, 2);
    assert.equal(pages[0].closed, true, "Close the update page before normal start");
    assert(!pages[1].closed, "Normal start page must remain open");
}

const RADIO_CONFIGURATION = {
    rig: { model_id: "hamlib:1", token_values: { retry: "7", timeout: "1234" } },
};
const ROTATOR_CONFIGURATION = {
    backend: "hamlib",
    hamlib: { model_id: "1", token_values: { retry: "6", timeout: "2345" } },
};

async function catRequest(page, type, request, expected) {
    return page.evaluate(
        ({ port, type, request, expected }) =>
            new Promise((resolve, reject) => {
                const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
                let sent = false;
                const finish = (error, message) => {
                    clearTimeout(timer);
                    socket.close();
                    if (error) reject(error);
                    else resolve(message);
                };
                const timer = setTimeout(
                    () => finish(new Error(`${type} ${request.action} timed out`)),
                    5000,
                );
                socket.onerror = () => finish(new Error(`${type} socket failed`));
                socket.onopen = () => {
                    socket.send(JSON.stringify({ version: 1, type, ...request }));
                    sent = true;
                };
                socket.onmessage = event => {
                    const message = JSON.parse(event.data);
                    if (
                        sent &&
                        message.type === type &&
                        Object.entries(expected).every(([key, value]) => message[key] === value)
                    )
                        finish(null, message);
                };
            }),
        { port: PRODUCT_PORT, type, request, expected },
    );
}

async function persistedCAT(page, save = false) {
    const result = {};
    for (const [type, name, configuration, event] of [
        ["radio", "Radio", RADIO_CONFIGURATION, "configuration"],
        ["rotator", "Rotator", ROTATOR_CONFIGURATION, "rotator_configuration"],
    ]) {
        if (save) {
            result[`${type}Save`] = await catRequest(
                page,
                type,
                {
                    action: `Set${name}Configuration`,
                    configuration,
                },
                { event: `${event}_result` },
            );
            assert.equal(result[`${type}Save`].ok, true, JSON.stringify(result));
        }
        result[type] = await catRequest(
            page,
            type,
            {
                action: `Get${name}Configuration`,
            },
            { event },
        );
        assertConfiguration(result[type], configuration);
    }
    result.radioOperation = await dummyCAT(page);
    result.rotatorOperation = await catRequest(
        page,
        "rotator",
        {
            action: "SetAzimuth",
            azimuth: 3,
        },
        { event: "status", azimuth: 3, status: "connected" },
    );
    result.rotatorStop = await catRequest(
        page,
        "rotator",
        { action: "Stop" },
        {
            event: "command_result",
            action: "Stop",
        },
    );
    assert.equal(result.rotatorStop.ok, true);
    return result;
}

async function processes(token) {
    const result = [];
    for (const pid of await readdir("/proc")) {
        if (!/^\d+$/.test(pid)) continue;
        try {
            const env = await readFile(`/proc/${pid}/environ`, "utf8");
            if (!env.split("\0").includes(`HOLY_PRODUCT_OWNER=${token}`)) continue;
            const stat = await readFile(`/proc/${pid}/stat`, "utf8");
            const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
            result.push({
                pid: Number(pid),
                parent: Number(fields[1]),
                start: fields[19],
                command: (await readFile(`/proc/${pid}/cmdline`, "utf8")).replaceAll("\0", " "),
            });
        } catch (error) {
            if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
        }
    }
    return result;
}

async function listenerOwners(port) {
    const inodes = new Set();
    for (const family of ["tcp", "tcp6"]) {
        for (const inode of listeningInodes(await readFile(`/proc/net/${family}`, "utf8"), port))
            inodes.add(`socket:[${inode}]`);
    }
    const owners = [];
    for (const pid of await readdir("/proc")) {
        if (!/^\d+$/.test(pid)) continue;
        try {
            for (const fd of await readdir(`/proc/${pid}/fd`)) {
                try {
                    if (inodes.has(await readlink(`/proc/${pid}/fd/${fd}`))) {
                        owners.push(Number(pid));
                        break;
                    }
                } catch (error) {
                    if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
                }
            }
        } catch (error) {
            if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
        }
    }
    return owners;
}

async function dummyCAT(page) {
    return page.evaluate(
        port =>
            new Promise((resolve, reject) => {
                const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
                const timer = setTimeout(() => {
                    socket.close();
                    reject(new Error("Dummy CAT operation timed out"));
                }, 3000);
                socket.onopen = () =>
                    socket.send(
                        JSON.stringify({
                            version: 1,
                            type: "radio",
                            action: "SetModeAndFreq",
                            mode: "CW",
                            freq: 14025,
                        }),
                    );
                socket.onmessage = event => {
                    const message = JSON.parse(event.data);
                    if (
                        message.type === "radio" &&
                        message.freq === 14025000 &&
                        message.mode === "CW" &&
                        message.status === "connected"
                    ) {
                        clearTimeout(timer);
                        socket.close();
                        resolve(message);
                    }
                };
            }),
        PRODUCT_PORT,
    );
}

export function corruptDownload(bytes) {
    assert(Buffer.isBuffer(bytes) && bytes.length > 0, "Supply nonempty candidate bytes");
    const altered = Buffer.from(bytes);
    altered[altered.length - 1] ^= 1;
    return altered;
}

export function assertCorruptionFailure(state) {
    assert.equal(state?.state, "failed", "Expected terminal corruption failure");
    assert.match(
        state.diagnostic || "",
        /SHA-?256|checksum|size.*(?:match|mismatch)/i,
        "Expected a corruption diagnostic",
    );
}

export async function runLinuxUpdate({
    baseline,
    candidate,
    version,
    dist,
    scenario = "update",
    validDownload = false,
}) {
    assert(["update", "corrupt-download"].includes(scenario), "Unknown scenario");
    assert(
        !validDownload || scenario === "corrupt-download",
        "Use valid-download only as a control",
    );
    const corruption = scenario === "corrupt-download";
    assert.equal(process.platform, "linux");
    for (const value of [baseline, candidate, version, dist])
        assert(value, "Supply all four inputs");
    const baselineVersion = path
        .basename(baseline)
        .match(/^catserver-v(.+)-linux-x86_64\.AppImage$/)?.[1];
    assert(baselineVersion, "Use the validated production baseline artifact name");
    const expectedVersion = readyVersion(version);
    assert.notEqual(baselineVersion, expectedVersion, "Candidate must differ from baseline");
    const baselineHash = hash(await readFile(baseline));
    const bytes = await readFile(candidate);
    const release = candidateRelease({
        version,
        platform: "linux",
        architecture: "x86_64",
        name: path.basename(candidate),
        bytes,
    });
    return withProductTest(
        {
            dist,
            manifest: { schema_version: 1, releases: [release] },
            artifacts: new Map([
                [
                    release.artifact.location,
                    corruption && !validDownload ? corruptDownload(bytes) : bytes,
                ],
            ]),
            browserBridge: true,
            preserveEvidence: true,
        },
        async ({ directories, env, backend, browserBridge }) => {
            const token = randomUUID();
            const active = path.join(directories.root, "CATServer.AppImage");
            await copyFile(baseline, active);
            await chmod(active, 0o700);
            const evidence = {
                scenario,
                validDownload,
                baselineHash,
                candidateHash: hash(bytes),
                servedHash: hash(corruption && !validDownload ? corruptDownload(bytes) : bytes),
                manifest: release,
                timeline: [],
                responses: [],
                browser: [],
                stateDirectory: directories.data,
            };
            const save = (name, data) => writeFile(path.join(directories.evidence, name), data);
            let page;
            let child;
            let reserve;
            let sampling = false;
            let sampler;
            let updateStart;
            const started = Date.now();
            const record = (kind, data) => {
                evidence.browser.push({ ms: Date.now() - started, kind, ...data });
                if (evidence.browser.length > 4000) evidence.browser.shift();
            };
            const responses = new Set();
            browserBridge.context.on("page", opened => {
                opened.on("console", message => record("console", { text: message.text() }));
                opened.on("pageerror", error => record("pageerror", { error: String(error) }));
                opened.on("websocket", socket => {
                    const openedAt = Date.now();
                    record("socket-open", { url: socket.url() });
                    socket.on("close", () => record("socket-close", { url: socket.url() }));
                    socket.on("framereceived", frame =>
                        record("socket-frame", {
                            original: opened === page,
                            openedAt,
                            payload: String(frame.payload).slice(0, 8192),
                        }),
                    );
                });
                opened.on("response", response => {
                    if (!/\/api\/(ready|update)/.test(response.url())) return;
                    const pending = response
                        .text()
                        .then(body => {
                            evidence.responses.push({
                                ms: Date.now() - started,
                                url: response.url(),
                                status: response.status(),
                                body,
                            });
                        })
                        .catch(error => record("response-error", { error: String(error) }));
                    responses.add(pending);
                    pending.finally(() => responses.delete(pending));
                });
            });
            const ready = async () => {
                try {
                    const response = await fetch(`http://127.0.0.1:${PRODUCT_PORT}/api/ready`, {
                        signal: AbortSignal.timeout(1000),
                    });
                    const body = await response.json();
                    evidence.responses.push({
                        ms: Date.now() - started,
                        source: "runner-ready",
                        status: response.status,
                        body,
                    });
                    return response.ok ? body : null;
                } catch {
                    return null;
                }
            };
            try {
                await browserBridge.context.tracing.start({ screenshots: true, snapshots: true });
                reserve = net.createServer();
                await new Promise((resolve, reject) => {
                    reserve.once("error", reject);
                    reserve.listen(PRODUCT_PORT, "127.0.0.1", resolve);
                });
                sampler = (async () => {
                    sampling = true;
                    let previous;
                    while (sampling) {
                        const owned = await processes(token);
                        const snapshot = JSON.stringify(owned);
                        if (snapshot !== previous)
                            evidence.timeline.push({ ms: Date.now() - started, processes: owned });
                        previous = snapshot;
                        await pause(250);
                    }
                })();
                await new Promise(resolve => reserve.close(resolve));
                child = spawn(
                    active,
                    [
                        "--backend",
                        new URL(backend.origin).host,
                        "--listen-port",
                        String(PRODUCT_PORT),
                        ...(corruption ? ["--dummy", "--dummy-rotator"] : []),
                    ],
                    {
                        env: { ...env, HOLY_PRODUCT_OWNER: token },
                        stdio: ["ignore", "pipe", "pipe"],
                    },
                );
                const stdout = [];
                const stderr = [];
                child.stdout.on("data", chunk => stdout.push(chunk));
                child.stderr.on("data", chunk => stderr.push(chunk));
                child.on("error", error => record("process-error", { error: String(error) }));
                child.on("exit", (code, signal) =>
                    evidence.timeline.push({
                        ms: Date.now() - started,
                        exit: { pid: child.pid, code, signal },
                    }),
                );
                evidence.timeline.push({
                    ms: Date.now() - started,
                    spawn: { pid: child.pid, active },
                });
                // Keep the streams available even if the launcher exits during exec.
                evidence.output = { stdout, stderr };
                page = await browserBridge.waitForFirstPage(20000);
                const before = await ready();
                assert.equal(
                    before?.version,
                    baselineVersion,
                    "Baseline readiness version differs",
                );
                evidence.baselineReady = before;
                assert.equal(page.url().split("/")[2], `127.0.0.1:${PRODUCT_PORT}`);
                assertSinglePage(browserBridge.evidence());
                if (!corruption)
                    evidence.configurationBeforeUpdate = await persistedCAT(page, true);
                const nonce = randomUUID();
                await page.evaluate(value => {
                    window.__productNonce = value;
                    window.__productStillWaiting = false;
                    window.__productActivationSeen = false;
                    new MutationObserver(() => {
                        if (
                            /Installing CAT Control|Reconnecting to CAT Control|Waiting for the original local port/.test(
                                document.body.innerText,
                            )
                        )
                            window.__productActivationSeen = true;
                        if (document.body.innerText.includes("Still waiting"))
                            window.__productStillWaiting = true;
                    }).observe(document.body, {
                        subtree: true,
                        childList: true,
                        characterData: true,
                    });
                }, nonce);
                const navigations = [];
                page.on("framenavigated", frame => {
                    if (frame === page.mainFrame()) navigations.push(frame.url());
                });
                await page
                    .getByRole("button", { name: "Update", exact: true })
                    .waitFor({ timeout: 20000 });
                const skip = page.getByRole("button", { name: "Skip", exact: true });
                if (await skip.isVisible()) await skip.click();
                updateStart = Date.now();
                await page
                    .getByRole("button", { name: "Update", exact: true })
                    .click({ timeout: 3000 });
                if (corruption) {
                    const statePath = path.join(directories.data, "holycluster/updates/state.json");
                    const retry = page.getByRole("button", { name: "Retry update", exact: true });
                    let failed = false;
                    while (Date.now() - updateStart < UPDATE_BOUND_MS - 10000) {
                        const dialog = page.getByRole("dialog");
                        if (
                            await dialog
                                .getByText("artifact SHA-256 does not match manifest", {
                                    exact: true,
                                })
                                .isVisible()
                        ) {
                            evidence.failureState = JSON.parse(await readFile(statePath, "utf8"));
                            assertCorruptionFailure(evidence.failureState);
                            failed = true;
                            break;
                        }
                        await pause(100);
                    }
                    evidence.elapsed = Date.now() - updateStart;
                    assert(
                        failed,
                        "Original UI did not show corruption failure within the strict bound",
                    );
                    evidence.failureText = await page.locator("body").innerText();
                    assert(evidence.failureText.includes(evidence.failureState.diagnostic));
                    evidence.artifactRequests = backend
                        .evidence()
                        .requests.filter(
                            request =>
                                request.path === release.artifact.location &&
                                request.status === 200,
                        );
                    assert(
                        evidence.artifactRequests.length > 0,
                        "No corruption download reached CATServer",
                    );
                    evidence.activeHash = hash(await readFile(active));
                    assert.equal(evidence.activeHash, baselineHash, "Active baseline was replaced");
                    evidence.rootEntries = await readdir(directories.root);
                    assert(
                        !evidence.rootEntries.some(name => name.startsWith("CATServer.AppImage.")),
                        "Activation replacement or .previous was created",
                    );
                    const updates = path.dirname(statePath);
                    evidence.updateEntries = await readdir(updates);
                    for (const name of [
                        "install-plan.json",
                        "restart-startup.json",
                        "session.json",
                    ])
                        assert(
                            !evidence.updateEntries.includes(name),
                            `Unexpected activation state: ${name}`,
                        );
                    evidence.baselineAfterFailure = await ready();
                    assert.equal(evidence.baselineAfterFailure?.version, baselineVersion);
                    evidence.navigations = navigations;
                    assert.deepEqual(navigations, [], "Original document navigated");
                    assert.equal(await page.evaluate(() => window.__productNonce), nonce);
                    assert.equal(new URL(page.url()).port, String(PRODUCT_PORT));
                    assert(!(await page.evaluate(() => window.__productStillWaiting)));
                    assert(
                        !(await page.evaluate(() => window.__productActivationSeen)),
                        "UI entered installation/restart",
                    );
                    for (const response of evidence.responses) {
                        if (!response.url?.includes("/api/update")) continue;
                        const state = JSON.parse(response.body);
                        assert(
                            !["installing", "installed"].includes(state.state),
                            "CATServer entered installation",
                        );
                        assert.equal(
                            state.session,
                            null,
                            "CATServer started an activation session",
                        );
                    }
                    evidence.listeners = await listenerOwners(PRODUCT_PORT);
                    assert.deepEqual(
                        evidence.listeners,
                        [child.pid],
                        "Original CATServer did not retain the port",
                    );
                    evidence.owned = await processes(token);
                    assert(evidence.owned.some(process => process.pid === child.pid));
                    assert(!evidence.timeline.some(event => event.exit), "Baseline process exited");
                    await page
                        .getByRole("dialog")
                        .getByRole("button", { name: "Close", exact: true })
                        .click();
                    const about = page.locator('[data-tour="about-trigger"]');
                    if (!(await about.isVisible()))
                        await page
                            .locator('[data-tour="top-bar-right-menu"]')
                            .click({ timeout: 2000 });
                    await about.click({ timeout: 2000 });
                    await retry.waitFor({ timeout: 2000 });
                    assert(await retry.isEnabled(), "Retry is not actionable");
                    const checksBefore = backend
                        .evidence()
                        .requests.filter(
                            request => request.path === "/catserver/releases/latest",
                        ).length;
                    await retry.click({ timeout: 2000 });
                    await retry.waitFor({ state: "hidden", timeout: 2000 });
                    evidence.retryState = JSON.parse(await readFile(statePath, "utf8"));
                    assert.equal(
                        evidence.retryState.state,
                        "idle",
                        "Retry did not clear the failure",
                    );
                    await page
                        .getByRole("button", { name: "Check for updates", exact: true })
                        .click({ timeout: 2000 });
                    await page
                        .getByRole("button", { name: "Update", exact: true })
                        .waitFor({ timeout: 5000 });
                    evidence.freshCheckState = JSON.parse(await readFile(statePath, "utf8"));
                    assert.equal(
                        evidence.freshCheckState.state,
                        "available",
                        "Retry did not permit a fresh check",
                    );
                    evidence.retryChecks =
                        backend
                            .evidence()
                            .requests.filter(
                                request => request.path === "/catserver/releases/latest",
                            ).length - checksBefore;
                    assert(evidence.retryChecks > 0, "Retry did not request a fresh manifest");
                    evidence.operation = await dummyCAT(page);
                    assertSinglePage(browserBridge.evidence());
                    evidence.browserBridge = browserBridge.evidence();
                    assert.equal(hash(await readFile(active)), baselineHash);
                    assert.equal((await ready())?.version, baselineVersion);
                    assert(
                        Date.now() - updateStart < UPDATE_BOUND_MS,
                        "Corruption check exceeded its strict bound",
                    );
                    return {
                        scenario,
                        baseline: before.version,
                        elapsed: evidence.elapsed,
                        evidenceDirectory: directories.evidence,
                    };
                }
                let after;
                let completed = false;
                while (Date.now() - updateStart < UPDATE_BOUND_MS - 5000) {
                    after = await ready();
                    if (after?.version === expectedVersion && !page.isClosed()) {
                        completed = await page
                            .getByText(`Verified running version: ${expectedVersion}`, {
                                exact: true,
                            })
                            .isVisible();
                        if (completed) break;
                    }
                    await pause(250);
                }
                evidence.elapsed = Date.now() - updateStart;
                evidence.candidateReady = after;
                evidence.navigations = navigations;
                evidence.activeHash = hash(await readFile(active));
                evidence.previousHash = hash(await readFile(`${active}.previous`));
                evidence.listeners = await listenerOwners(PRODUCT_PORT);
                evidence.owned = await processes(token);
                const failures = [];
                const check = (condition, message) => {
                    if (!condition) failures.push(message);
                };
                evidence.originalPageClosed = page.isClosed();
                check(!evidence.originalPageClosed, "Original page closed");
                if (!page.isClosed()) {
                    evidence.pageState = await page.evaluate(() => ({
                        nonce: window.__productNonce,
                        stillWaiting: window.__productStillWaiting,
                        text: document.body.innerText,
                    }));
                    check(evidence.pageState.nonce === nonce, "Original page reloaded");
                    check(!evidence.pageState.stillWaiting, "UI reached Still waiting");
                }
                check(navigations.length === 0, "Main frame navigated after initial load");
                check(
                    completed && evidence.elapsed < UPDATE_BOUND_MS,
                    `Original page did not complete the update in ${UPDATE_BOUND_MS} ms`,
                );
                check(
                    after?.version === expectedVersion,
                    "Original port did not return the candidate version",
                );
                check(
                    evidence.activeHash === evidence.candidateHash,
                    "Active AppImage hash differs from candidate",
                );
                check(
                    evidence.previousHash === baselineHash,
                    "Previous AppImage hash differs from baseline",
                );
                check(
                    evidence.listeners.length === 1 &&
                        evidence.owned.some(process => process.pid === evidence.listeners[0]),
                    "Expected one owned CATServer listener",
                );
                check(
                    evidence.browser.some(
                        event =>
                            event.kind === "socket-frame" &&
                            event.original &&
                            event.openedAt > updateStart &&
                            event.payload.includes(version),
                    ),
                    "Original page did not reconnect automatically",
                );
                if (after?.version === expectedVersion && !page.isClosed()) {
                    evidence.configurationAfterUpdate = await persistedCAT(page).catch(error => {
                        failures.push(String(error));
                        return null;
                    });
                }
                check(
                    Boolean(evidence.configurationAfterUpdate),
                    "Persisted CAT configurations or operations failed after update",
                );
                check(
                    Date.now() - updateStart < UPDATE_BOUND_MS,
                    "Update exceeded its strict bound",
                );
                try {
                    assertSinglePage(browserBridge.evidence());
                } catch (error) {
                    failures.push(error.message);
                }
                assert.deepEqual(failures, [], failures.join("; "));
                evidence.updateBrowserBridge = browserBridge.evidence();
                await page.screenshot({
                    path: path.join(directories.evidence, "update-complete.png"),
                });
                await save("update-complete.html", await page.content());
                await page.close();
                const stopResponse = await fetch(`http://127.0.0.1:${PRODUCT_PORT}/exit`, {
                    method: "POST",
                    signal: AbortSignal.timeout(3000),
                });
                assert(stopResponse.ok, "Normal stop request failed");
                const stopStart = Date.now();
                while ((await processes(token)).length && Date.now() - stopStart < 10000)
                    await pause(100);
                evidence.normalStop = {
                    processes: await processes(token),
                    listeners: await listenerOwners(PRODUCT_PORT),
                };
                assert.deepEqual(evidence.normalStop.processes, [], "Normal stop left processes");
                assert.deepEqual(evidence.normalStop.listeners, [], "Normal stop retained port");
                const newPage = browserBridge.context.waitForEvent("page", { timeout: 20000 });
                const restarted = spawn(
                    active,
                    [
                        "--backend",
                        new URL(backend.origin).host,
                        "--listen-port",
                        String(PRODUCT_PORT),
                    ],
                    {
                        env: { ...env, HOLY_PRODUCT_OWNER: token },
                        stdio: ["ignore", "pipe", "pipe"],
                    },
                );
                restarted.stdout.on("data", chunk => stdout.push(chunk));
                restarted.stderr.on("data", chunk => stderr.push(chunk));
                restarted.on("error", error => record("process-error", { error: String(error) }));
                evidence.normalStart = { pid: restarted.pid, active, dummyOverrides: false };
                page = await newPage;
                await page.waitForURL(`http://127.0.0.1:${PRODUCT_PORT}/**`, { timeout: 20000 });
                await page.waitForLoadState("domcontentloaded", { timeout: 20000 });
                assert.equal(new URL(page.url()).port, String(PRODUCT_PORT));
                evidence.normalReady = await ready();
                assert.equal(evidence.normalReady?.version, expectedVersion);
                assert.equal(
                    evidence.normalReady.update_id,
                    null,
                    "Normal start reused update session",
                );
                assert.notEqual(evidence.normalReady.instance_id, after.instance_id);
                evidence.normalListeners = await listenerOwners(PRODUCT_PORT);
                assert.deepEqual(evidence.normalListeners, [restarted.pid]);
                assert.equal(hash(await readFile(active)), evidence.candidateHash);
                evidence.configurationAfterNormalStart = await persistedCAT(page);
                evidence.normalBrowserBridge = browserBridge.evidence();
                assertNormalRelaunch(evidence.normalBrowserBridge);
                return {
                    baseline: before.version,
                    candidate: version,
                    elapsed: evidence.elapsed,
                    normalRelaunch: true,
                    evidenceDirectory: directories.evidence,
                };
            } finally {
                try {
                    sampling = false;
                    await sampler;
                    if (reserve?.listening) await new Promise(resolve => reserve.close(resolve));
                    for (const opened of browserBridge.context.pages()) {
                        if (opened.isClosed()) continue;
                        const id = browserBridge.context.pages().indexOf(opened);
                        await opened
                            .screenshot({ path: path.join(directories.evidence, `page-${id}.png`) })
                            .catch(() => {});
                        await save(`page-${id}.html`, await opened.content().catch(String));
                    }
                    await browserBridge.context.tracing
                        .stop({ path: path.join(directories.evidence, "browser-trace.zip") })
                        .catch(() => {});
                    await Promise.allSettled([...responses]);
                    const output = evidence.output;
                    evidence.output = undefined;
                    await save("stdout.log", Buffer.concat(output?.stdout || []));
                    await save("stderr.log", Buffer.concat(output?.stderr || []));
                    await save("update-evidence.json", JSON.stringify(evidence, null, 2));
                } finally {
                    // The token survives updater exec; PID identity is checked again before each signal.
                    for (const signal of ["SIGTERM", "SIGKILL"]) {
                        for (const owned of await processes(token)) {
                            const current = (await processes(token)).find(
                                process =>
                                    process.pid === owned.pid && process.start === owned.start,
                            );
                            if (current) {
                                try {
                                    process.kill(owned.pid, signal);
                                } catch (error) {
                                    if (error.code !== "ESRCH")
                                        record("cleanup-error", { error: String(error) });
                                }
                            }
                        }
                        await pause(250);
                    }
                }
            }
        },
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const { values } = parseArgs({
            options: {
                baseline: { type: "string" },
                candidate: { type: "string" },
                version: { type: "string" },
                dist: { type: "string" },
                scenario: { type: "string", default: "update" },
                "valid-download": { type: "boolean", default: false },
            },
        });
        console.log(await runLinuxUpdate({ ...values, validDownload: values["valid-download"] }));
    } catch (error) {
        console.error(error);
        if (error.evidenceDirectory) console.error(`Failure evidence: ${error.evidenceDirectory}`);
        process.exitCode = 1;
    }
}
