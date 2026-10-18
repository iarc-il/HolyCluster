import { NonErrorThrown, toError } from "@/utils/errors.js";
import { describe, expect, it } from "vitest";

describe("error normalization", () => {
    it.each([
        ["string", "diagnostic string"],
        ["number", 42],
        ["boolean", false],
        ["null", null],
        ["undefined", undefined],
        ["object", { marker: "diagnostic object" }],
    ])("converts a %s to a labeled Error", (kind, value) => {
        const error = toError(value);

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(NonErrorThrown);
        expect(error.name).toBe("NonErrorThrown");
        expect(error.original_kind).toBe(kind);
        expect(error.original_value).toBe(value);
        expect(error.stack_origin).toBe("synthetic_capture");
        expect(error.stack).toContain("NonErrorThrown");
    });

    it("keeps native Errors and their causes unchanged", () => {
        const cause = new Error("diagnostic cause");
        const error = new TypeError("diagnostic failure", { cause });

        expect(toError(error)).toBe(error);
        expect(toError(error).cause).toBe(cause);
    });

    it("keeps DOMException unchanged", () => {
        const error = new DOMException("diagnostic failure", "InvalidStateError");

        expect(toError(error)).toBe(error);
    });

    it("keeps a cross-realm Error unchanged", () => {
        const frame = document.createElement("iframe");
        document.body.append(frame);
        try {
            const error = new frame.contentWindow.TypeError("diagnostic failure");

            expect(toError(error)).toBe(error);
        } finally {
            frame.remove();
        }
    });
});
