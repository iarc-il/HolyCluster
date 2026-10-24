import assert from "node:assert/strict";
import test from "node:test";
import {
    PRODUCT_PORT,
    UPDATE_BOUND_MS,
    assertSinglePage,
    listeningInodes,
    readyVersion,
} from "./linux_update_product.mjs";

test("match listening sockets, not established connections or other ports", () => {
    const table = `  sl  local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode
    0: 0100007F:A112 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 111
    1: 0100007F:A112 0100007F:1234 01 00000000:00000000 00:00000000 00000000 1000 0 222
    2: 0100007F:A113 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 333
    3: 00000000000000000000000001000000:A112 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 444`;
    assert.deepEqual(listeningInodes(table, PRODUCT_PORT), ["111", "444"]);
    assert.deepEqual(listeningInodes(table, 1), []);
});

test("ignore only the persistent browser startup tab", () => {
    const evidence = { launcherCount: 1, pages: [{ startup: true }, { startup: false }] };
    assertSinglePage(evidence);
    assert.throws(() => assertSinglePage({ ...evidence, launcherCount: 2 }), /extra browser page/);
    assert.throws(
        () => assertSinglePage({ ...evidence, pages: [...evidence.pages, {}] }),
        /Extra product page/,
    );
    assert.throws(() => assertSinglePage({ ...evidence, launcherCount: 0 }));
});

test("match CATServer readiness version normalization", () => {
    assert.equal(readyVersion("catserver-v1.3.3"), "1.3.3");
    assert.equal(readyVersion("catserver-v1.3.4-1-g0b721f4b"), "1.3.4-1");
    assert.equal(readyVersion("1.3.4"), "1.3.4");
});

test("keep the update deadline below Still waiting", () => {
    assert(UPDATE_BOUND_MS > 0 && UPDATE_BOUND_MS < 60000);
});
