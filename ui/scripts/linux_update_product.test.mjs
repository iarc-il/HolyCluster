import assert from "node:assert/strict";
import test from "node:test";
import {
    PRODUCT_PORT,
    UPDATE_BOUND_MS,
    assertConfiguration,
    assertCorruptionFailure,
    assertNormalRelaunch,
    assertSinglePage,
    boundedOutput,
    corruptDownload,
    listeningInodes,
    readyVersion,
} from "./linux_update_product.mjs";

test("retain complete output within the byte limit", () => {
    const output = boundedOutput(10);
    output.append(Buffer.from("abc"));
    output.append(Buffer.from("defghij"));
    assert.equal(output.bytes().toString(), "abcdefghij");
    assert.deepEqual(output.stats(), { totalBytes: 10, retainedBytes: 10, droppedBytes: 0 });
});

test("bound repeated output and retain startup and final diagnostics", () => {
    const output = boundedOutput(10);
    output.append(Buffer.from("start"));
    for (let index = 0; index < 1000; index++) output.append(Buffer.alloc(100, 120));
    output.append(Buffer.from("error"));
    assert.equal(output.bytes().toString(), "start\n[100000 output bytes omitted]\nerror");
    assert.deepEqual(output.stats(), {
        totalBytes: 100010,
        retainedBytes: 10,
        droppedBytes: 100000,
    });
});

test("copy retained output from oversized chunks", () => {
    const output = boundedOutput(10);
    const chunk = Buffer.from("first0123456789last!");
    output.append(chunk);
    chunk.fill(0);
    assert.equal(output.bytes().toString(), "first\n[10 output bytes omitted]\nlast!");
    assert.throws(() => boundedOutput(1));
});

test("match listening sockets, not established connections or other ports", () => {
    const table = `  sl  local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode
    0: 0100007F:A112 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 111
    1: 0100007F:A112 0100007F:1234 01 00000000:00000000 00:00000000 00000000 1000 0 222
    2: 0100007F:A113 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 333
    3: 00000000000000000000000001000000:A112 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 444`;
    assert.deepEqual(listeningInodes(table, PRODUCT_PORT), ["111", "444"]);
    assert.deepEqual(listeningInodes(table, 1), []);
});

test("page checks reject extra pages, missing launches, and an open update page", () => {
    for (const [check, evidence, invalid] of [
        [
            assertSinglePage,
            { launcherCount: 1, pages: [{ startup: true }, {}] },
            [{ launcherCount: 2 }, { launcherCount: 0 }, { pages: [{}, {}] }],
        ],
        [
            assertNormalRelaunch,
            { launcherCount: 2, pages: [{ startup: true }, { closed: true }, {}] },
            [
                { launcherCount: 3 },
                { pages: [{}] },
                { pages: [{}, {}] },
                { pages: [{ closed: true }, {}, {}] },
            ],
        ],
    ]) {
        check(evidence);
        for (const change of invalid) assert.throws(() => check({ ...evidence, ...change }));
    }
});

test("configuration readback rejects missing, changed, and extra settings", () => {
    const expected = { rig: { model_id: "hamlib:1", token_values: { retry: "7" } } };
    const response = { version: 1, type: "radio", event: "configuration", ...expected };
    assertConfiguration(response, expected);
    for (const change of [
        { rig: null },
        { rig: { ...expected.rig, token_values: {} } },
        { rig: { ...expected.rig, token_values: { retry: "8" } } },
        { extra: true },
    ])
        assert.throws(() => assertConfiguration({ ...response, ...change }, expected));
});

test("match CATServer readiness version normalization", () => {
    assert.equal(readyVersion("catserver-v1.3.3"), "1.3.3");
    assert.equal(readyVersion("catserver-v1.3.4-1-g0b721f4b"), "1.3.4-1");
    assert.equal(readyVersion("1.3.4"), "1.3.4");
});

test("keep the update deadline below Still waiting", () => {
    assert(UPDATE_BOUND_MS > 0 && UPDATE_BOUND_MS < 60000);
});

test("alter bytes without changing candidate size or input", () => {
    const valid = Buffer.from("valid candidate");
    const altered = corruptDownload(valid);
    assert.equal(altered.length, valid.length);
    assert.notDeepEqual(altered, valid);
    assert.equal(valid.toString(), "valid candidate");
    assert.throws(() => corruptDownload(Buffer.alloc(0)));
});

test("accept only a terminal corruption failure with a diagnostic", () => {
    const state = { state: "failed", diagnostic: "SHA256 mismatch" };
    assertCorruptionFailure(state);
    for (const state of [
        { state: "idle" },
        { state: "downloading", diagnostic: "SHA256 mismatch" },
        { state: "failed" },
        { state: "failed", diagnostic: "Network unavailable" },
    ])
        assert.throws(() => assertCorruptionFailure(state), /corrupt|terminal/i);
});
