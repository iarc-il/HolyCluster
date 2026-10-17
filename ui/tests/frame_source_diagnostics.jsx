import { sanitizeSentryEvent } from "@/sentry";
import { describe, expect, it } from "vitest";

function report(values) {
    return sanitizeSentryEvent({ exception: { values } });
}

function exception(frames) {
    return { type: "Error", stacktrace: { frames } };
}

describe("frame source diagnostics", () => {
    it("distinguishes missing filenames from removed filenames at each frame", () => {
        const event = report([
            exception([
                { function: "sendDataToNative", lineno: 1 },
                { filename: "https://private.example/users/secret.js?secret", lineno: 2 },
                { filename: "", lineno: 3 },
                { filename: "/assets/app.js", lineno: 4 },
            ]),
        ]);
        expect(event.contexts.diagnostic.frame_sources).toEqual([
            {
                exception_index: 0,
                frame_index: 0,
                source_class: "unknown",
                filename_state: "absent",
            },
            {
                exception_index: 0,
                frame_index: 1,
                source_class: "cross_origin_url",
                filename_state: "removed",
            },
            {
                exception_index: 0,
                frame_index: 2,
                source_class: "inline_or_unrecognized",
                filename_state: "removed",
            },
            {
                exception_index: 0,
                frame_index: 3,
                source_class: "relative_source_path",
                filename_state: "retained",
            },
        ]);
        expect(event.exception.values[0].stacktrace.frames).toHaveLength(4);
        expect(event.exception.values[0].stacktrace.frames[0].filename).toBeUndefined();
        expect(event.exception.values[0].stacktrace.frames[1].filename).toBeUndefined();
        expect(JSON.stringify(event)).not.toMatch(/private\.example|secret/);
        expect(event.fingerprint).toBeUndefined();
    });

    it("keeps source categories separate from proof of bundle ownership", () => {
        const origin = globalThis.location.origin;
        const event = report([
            exception([
                { filename: `${origin}/users/secret.js` },
                { filename: `${origin}/assets/unknown.js` },
                { filename: "https://private.example/assets/unknown.js?secret" },
                { filename: "../../src/unknown.js" },
                { filename: "chrome-extension://secret/script.js" },
                { filename: "file:///Users/private/secret.js" },
            ]),
        ]);
        expect(event.contexts.diagnostic.frame_sources.map(frame => frame.source_class)).toEqual([
            "same_origin_url",
            "same_origin_asset_path",
            "external_asset_path",
            "relative_source_path",
            "extension",
            "local_or_unrecognized",
        ]);
        expect(JSON.stringify(event)).not.toMatch(/shipped_source|private\.example|secret/);
    });

    it("retains exception and frame indices across stackless causes and bounds added evidence", () => {
        const event = report([
            exception([{ filename: "https://private.example/secret.js" }]),
            { type: "Error" },
            exception(Array.from({ length: 55 }, () => ({ filename: "/assets/app.js" }))),
        ]);
        const sources = event.contexts.diagnostic.frame_sources;
        expect(sources).toHaveLength(50);
        expect(sources[0]).toMatchObject({ exception_index: 2, frame_index: 5 });
        expect(sources.at(-1)).toMatchObject({ exception_index: 2, frame_index: 54 });
        expect(JSON.stringify(sources).length).toBeLessThan(6500);
        expect(event.exception.values[0].stacktrace.frames).toHaveLength(1);
        expect(event.exception.values[2].stacktrace.frames).toHaveLength(55);
        const causes = report([exception([{}]), { type: "Error" }, exception([{}, {}])]);
        expect(
            causes.contexts.diagnostic.frame_sources.map(({ exception_index, frame_index }) => [
                exception_index,
                frame_index,
            ]),
        ).toEqual([
            [0, 0],
            [2, 0],
            [2, 1],
        ]);
    });
});
