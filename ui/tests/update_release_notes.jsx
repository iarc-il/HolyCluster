import { afterEach, describe, expect, it, vi } from "vitest";

import { release_notes_for } from "@/components/UpdateControls.jsx";
import { prepareSentryEvent } from "@/sentry.js";

const VERSION_PATTERN = /^\d+\.\d+\.\d+-\d+(?:-g[0-9a-f]+)?$/i;

function recursion_error() {
    const error = new Error("too much recursion");
    error.name = "InternalError";
    return error;
}

function fail_version_test(error) {
    const native_test = RegExp.prototype.test;
    RegExp.prototype.test = function (value) {
        if (this.source === VERSION_PATTERN.source) {
            throw error;
        }
        return native_test.call(this, value);
    };
    return () => {
        RegExp.prototype.test = native_test;
    };
}

function report(error) {
    return prepareSentryEvent(
        {
            exception: {
                values: [
                    {
                        type: error.name,
                        value: error.message,
                        stacktrace: { frames: [{ filename: "/assets/app.js", lineno: 1 }] },
                    },
                ],
            },
        },
        { originalException: error },
    );
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe("release note diagnostics", () => {
    it.each([
        ["1.3.2-private", "string", "1.3.2-private".length],
        [13, "number", null],
    ])(
        "records bounded evidence when the version test fails for %j",
        (version, version_type, version_length) => {
            const error = recursion_error();
            const restore = fail_version_test(error);
            let caught;
            try {
                release_notes_for(version);
            } catch (thrown) {
                caught = thrown;
            } finally {
                restore();
            }
            expect(caught).toBe(error);

            const result = report(error);
            expect(result.contexts.diagnostic).toMatchObject({
                operation: "release_notes",
                release_notes_step: "version_test",
                version_type,
                version_length,
            });
            expect(JSON.stringify(result)).not.toContain("private");
        },
    );
});
