import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { candidateRelease, startProductBackend, withProductTest } from "./product_test.mjs";

async function fixture(t) {
    const root = await mkdtemp(path.join(os.tmpdir(), "product-test-fixture-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const dist = path.join(root, "dist");
    await mkdir(dist);
    await writeFile(path.join(dist, "index.html"), "<title>Product</title>");
    await writeFile(path.join(root, "secret"), "secret");
    const bytes = Buffer.from("candidate bytes");
    const release = candidateRelease({
        version: "1.2.3",
        platform: "linux",
        architecture: "x86_64",
        name: "candidate.AppImage",
        bytes,
    });
    return { root, dist, bytes, release, manifest: { schema_version: 1, releases: [release] } };
}

function rawRequest(origin, target, options = {}) {
    return new Promise((resolve, reject) => {
        const req = request(origin, { path: target, method: "GET", ...options }, response => {
            const chunks = [];
            response.on("data", chunk => chunks.push(chunk));
            response.on("end", () =>
                resolve({ status: response.statusCode, body: Buffer.concat(chunks) }),
            );
        });
        req.on("error", reject);
        req.end(options.body);
    });
}

test("serve one manifest snapshot and exact candidate bytes", async t => {
    const f = await fixture(t);
    const backend = await startProductBackend({
        ...f,
        artifacts: new Map([[f.release.artifact.location, f.bytes]]),
    });
    t.after(() => backend.close());
    const expected = structuredClone(f.manifest);
    f.manifest.releases[0].version = "changed";
    f.bytes.fill(0);
    for (let i = 0; i < 2; i++) {
        const response = await fetch(`${backend.origin}/catserver/releases/latest`);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(await response.json(), expected);
    }
    const response = await fetch(backend.origin + f.release.artifact.location);
    assert.equal(await response.text(), "candidate bytes");
    assert.equal(expected.releases[0].version, "1.2.3");
    assert.equal(expected.releases[0].platform, "linux");
    assert.equal(expected.releases[0].architecture, "x86_64");
    assert.equal(expected.releases[0].artifact.size, 15);
    assert.equal(
        expected.releases[0].artifact.sha256,
        "732d058fadd90c70f22429227ab5d9c74919217099efe737aa46835ce3a60856",
    );
    assert.equal(await (await fetch(backend.origin)).text(), "<title>Product</title>");
    assert.equal((await fetch(`${backend.origin}/api/update`)).status, 404);
});

test("serve changed and truncated bytes without changing metadata", async t => {
    const f = await fixture(t);
    for (const bytes of [f.bytes.subarray(0, 3), Buffer.alloc(f.bytes.length, 1)]) {
        const backend = await startProductBackend({
            ...f,
            artifacts: new Map([[f.release.artifact.location, bytes]]),
        });
        try {
            assert.deepEqual(
                await (await fetch(`${backend.origin}/catserver/releases/latest`)).json(),
                f.manifest,
            );
            assert.deepEqual(
                Buffer.from(
                    await (await fetch(backend.origin + f.release.artifact.location)).arrayBuffer(),
                ),
                bytes,
            );
            assert(
                backend
                    .evidence()
                    .requests.some(
                        entry => entry.path === f.release.artifact.location && entry.status === 200,
                    ),
            );
        } finally {
            await backend.close();
        }
    }
});

test("reject traversal and bound request data and evidence", async t => {
    const f = await fixture(t);
    const backend = await startProductBackend({
        ...f,
        artifacts: new Map(),
        maxRequests: 3,
        maxTargetBytes: 128,
    });
    t.after(() => backend.close());
    for (const target of ["/%2e%2e/secret", "/..%2fsecret", "/%5c..%5csecret", "/%00", "/%ZZ"]) {
        assert.equal((await rawRequest(backend.origin, target)).status, 400, target);
    }
    assert.equal((await rawRequest(backend.origin, `/${"a".repeat(1024)}`)).status, 414);
    assert.equal(
        (await rawRequest(backend.origin, "/", { method: "POST", body: "x".repeat(4096) })).status,
        413,
    );
    const evidence = backend.evidence();
    assert.equal(evidence.requests.length, 3);
    assert.equal(evidence.droppedRequests, 4);
    assert(evidence.requests.every(entry => Buffer.byteLength(entry.path) <= 128));
    assert(!JSON.stringify(evidence).includes("xxxx"));
    assert(JSON.stringify(evidence).length < 1024);
    evidence.requests[0].path = "changed";
    assert.notEqual(backend.evidence().requests[0].path, "changed");
});

test("reject static files outside dist through a directory link", async t => {
    const f = await fixture(t);
    await symlink(f.root, path.join(f.dist, "outside"), "junction");
    const backend = await startProductBackend({ ...f, artifacts: new Map() });
    t.after(() => backend.close());
    assert.equal((await fetch(`${backend.origin}/outside/secret`)).status, 400);
});

test("isolate state, remove it on success, and preserve evidence on failure", async t => {
    const f = await fixture(t);
    let success;
    await withProductTest(
        { ...f, artifacts: new Map(), temporaryParent: f.root },
        async context => {
            success = context.directories;
            const dirs = Object.values(success).filter(value => value !== success.root);
            assert.equal(new Set(dirs).size, dirs.length);
            for (const directory of dirs) assert((await stat(directory)).isDirectory());
            assert.equal(context.env.HOME, success.home);
            assert.equal(context.env.XDG_DATA_HOME, success.data);
            assert.equal(context.env.XDG_CONFIG_HOME, success.config);
            assert.equal(context.env.XDG_STATE_HOME, success.state);
            assert.equal(context.env.XDG_CACHE_HOME, success.cache);
        },
    );
    await assert.rejects(stat(success.root), { code: "ENOENT" });
    let failure;
    let failedOrigin;
    await assert.rejects(
        withProductTest({ ...f, artifacts: new Map(), temporaryParent: f.root }, async context => {
            failure = context.directories;
            failedOrigin = context.backend.origin;
            await fetch(`${context.backend.origin}/catserver/releases/latest`);
            throw new Error("expected failure");
        }),
        error =>
            error.message === "expected failure" && error.evidenceDirectory === failure.evidence,
    );
    const evidence = JSON.parse(
        await readFile(path.join(failure.evidence, "failure.json"), "utf8"),
    );
    assert.match(evidence.error, /expected failure/);
    assert.equal(evidence.requests[0].path, "/catserver/releases/latest");
    assert((await stat(failure.home)).isDirectory());
    await assert.rejects(fetch(failedOrigin));
});

test("retain successful scenario evidence only when requested", async t => {
    const f = await fixture(t);
    let directories;
    let origin;
    await withProductTest(
        { ...f, artifacts: new Map(), temporaryParent: f.root, preserveEvidence: true },
        async context => {
            directories = context.directories;
            origin = context.backend.origin;
            await fetch(`${origin}/catserver/releases/latest`);
        },
    );
    const evidence = JSON.parse(
        await readFile(path.join(directories.evidence, "product.json"), "utf8"),
    );
    assert.equal(evidence.requests[0].path, "/catserver/releases/latest");
    assert((await stat(directories.data)).isDirectory());
    await assert.rejects(fetch(origin));
});

test("preserve bounded evidence if backend setup fails", async t => {
    const f = await fixture(t);
    let evidenceDirectory;
    await assert.rejects(
        withProductTest(
            {
                ...f,
                dist: path.join(f.root, "missing"),
                artifacts: new Map(),
                temporaryParent: f.root,
            },
            () => assert.fail("Backend must start first"),
        ),
        error => {
            evidenceDirectory = error.evidenceDirectory;
            return error.code === "ENOENT";
        },
    );
    const evidence = JSON.parse(
        await readFile(path.join(evidenceDirectory, "failure.json"), "utf8"),
    );
    assert.deepEqual(evidence.requests, []);
    assert(evidence.error.length <= 16384);
});

test("reject unsupported isolation platforms before creating state", async t => {
    const f = await fixture(t);
    const before = await readdir(f.root);
    const moduleUrl = new URL("./product_test.mjs", import.meta.url).href;
    for (const platform of ["win32", "darwin"]) {
        execFileSync(process.execPath, [
            "--input-type=module",
            "--eval",
            `
            import assert from "node:assert/strict";
            import { withProductTest } from ${JSON.stringify(moduleUrl)};
            Object.defineProperty(process, "platform", { value: ${JSON.stringify(platform)} });
            await assert.rejects(
                withProductTest({ temporaryParent: ${JSON.stringify(f.root)} }, () => assert.fail("Must not run")),
                error => error.message === "Product state isolation requires Linux",
            );
        `,
        ]);
        assert.deepEqual(await readdir(f.root), before);
    }
});

test("keep the product error when failure evidence cannot be written", async t => {
    for (const unavailable of ["deleted", "file"]) {
        await t.test(unavailable, async t => {
            const f = await fixture(t);
            const primary = new Error("product failure");
            let directories;
            let origin;
            await assert.rejects(
                withProductTest(
                    { ...f, artifacts: new Map(), temporaryParent: f.root },
                    async context => {
                        directories = context.directories;
                        origin = context.backend.origin;
                        await rm(directories.evidence, { recursive: true });
                        if (unavailable === "file")
                            await writeFile(directories.evidence, "unavailable");
                        throw primary;
                    },
                ),
                error => {
                    assert.equal(error, primary);
                    assert.equal(error.evidenceDirectory, directories.evidence);
                    assert(error.evidenceWriteError instanceof Error);
                    assert.equal(
                        error.evidenceWriteError.code,
                        unavailable === "deleted" ? "ENOENT" : "ENOTDIR",
                    );
                    return true;
                },
            );
            assert((await stat(directories.home)).isDirectory());
            await assert.rejects(fetch(origin));
        });
    }
});
