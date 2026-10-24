import assert from "node:assert/strict";
import test from "node:test";
import { assertCorruptionFailure, corruptDownload } from "./linux_update_product.mjs";

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
