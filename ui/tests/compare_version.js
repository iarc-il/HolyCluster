import { describe, expect, it } from "vitest";

import { compare_version } from "@/utils.js";

describe("compare_version", () => {
    it("returns 0 for equal versions", () => {
        expect(compare_version([1, 0, 0, 0], [1, 0, 0, 0])).toBe(0);
        expect(compare_version([0, 0, 0], [0, 0, 0])).toBe(0);
        expect(compare_version([], [])).toBe(0);
    });

    it("returns positive when a > b", () => {
        expect(compare_version([2, 0, 0, 0], [1, 0, 0, 0])).toBeGreaterThan(0);
        expect(compare_version([1, 1, 0, 0], [1, 0, 0, 0])).toBeGreaterThan(0);
        expect(compare_version([1, 0, 1, 0], [1, 0, 0, 0])).toBeGreaterThan(0);
        expect(compare_version([1, 0, 0, 1], [1, 0, 0, 0])).toBeGreaterThan(0);
    });

    it("returns negative when a < b", () => {
        expect(compare_version([1, 0, 0, 0], [2, 0, 0, 0])).toBeLessThan(0);
        expect(compare_version([1, 0, 0, 0], [1, 1, 0, 0])).toBeLessThan(0);
        expect(compare_version([1, 0, 0, 0], [1, 0, 1, 0])).toBeLessThan(0);
        expect(compare_version([1, 0, 0, 0], [1, 0, 0, 1])).toBeLessThan(0);
    });

    it("handles null values", () => {
        expect(compare_version(null, null)).toBe(0);
        expect(compare_version(null, [1, 0, 0, 0])).toBeLessThan(0);
        expect(compare_version([1, 0, 0, 0], null)).toBeGreaterThan(0);
    });

    it("handles undefined values", () => {
        expect(compare_version(undefined, undefined)).toBe(0);
        expect(compare_version(undefined, [1, 0, 0, 0])).toBeLessThan(0);
        expect(compare_version([1, 0, 0, 0], undefined)).toBeGreaterThan(0);
    });

    it("correctly compares multi-digit version parts", () => {
        expect(compare_version([1, 10, 0, 0], [1, 9, 0, 0])).toBeGreaterThan(0);
        expect(compare_version([10, 0, 0, 0], [2, 0, 0, 0])).toBeGreaterThan(0);
    });

    it("treats missing elements as 0", () => {
        expect(compare_version([1], [1, 0, 0, 0])).toBe(0);
        expect(compare_version([1, 0, 0, 1], [1, 0, 0])).toBeGreaterThan(0);
        expect(compare_version([1, 0, 0], [1, 0, 0, 1])).toBeLessThan(0);
    });

    it("handles the exact tagged_api_version check", () => {
        const tagged = [1, 1, 0, 0];
        expect(compare_version([1, 1, 0, 0], tagged)).toBe(0);
        expect(compare_version([1, 1, 0, 1], tagged)).toBeGreaterThan(0);
        expect(compare_version([1, 0, 5, 0], tagged)).toBeLessThan(0);
        expect(compare_version(null, tagged)).toBeLessThan(0);
    });

    it("handles the exact [1, 0, 0, 0] baseline check", () => {
        const baseline = [1, 0, 0, 0];
        expect(compare_version([1, 0, 0, 0], baseline)).toBe(0);
        expect(compare_version([1, 0, 0, 1], baseline)).toBeGreaterThan(0);
        expect(compare_version([1, 1, 0, 0], baseline)).toBeGreaterThan(0);
        expect(compare_version([0, 9, 0, 0], baseline)).toBeLessThan(0);
        expect(compare_version(null, baseline)).toBeLessThan(0);
    });

    it("handles mismatched bad version strings parsed to [0,0,0,0]", () => {
        expect(compare_version([0, 0, 0, 0], [0, 0, 0, 0])).toBe(0);
        expect(compare_version([0, 0, 0, 0], [1, 0, 0, 0])).toBeLessThan(0);
    });
});
