import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
const html = readFileSync("index.html", "utf8");

describe("online-required install metadata", () => {
    it("launches HolyCluster at the root in standalone mode", () => {
        expect(manifest).toMatchObject({
            name: "HolyCluster",
            short_name: "HolyCluster",
            start_url: "/",
            scope: "/",
            display: "standalone",
            theme_color: "#0b141a",
            background_color: "#0b141a",
        });
        expect(manifest.description).toContain("Requires an internet connection");
    });

    it("declares regular and dedicated maskable PNG icons", () => {
        expect(manifest.icons).toEqual([
            {
                src: "/icons/holycluster-192.png",
                sizes: "192x192",
                type: "image/png",
                purpose: "any",
            },
            {
                src: "/icons/holycluster-512.png",
                sizes: "512x512",
                type: "image/png",
                purpose: "any",
            },
            {
                src: "/icons/holycluster-maskable-512.png",
                sizes: "512x512",
                type: "image/png",
                purpose: "maskable",
            },
        ]);
    });

    it("links the manifest and Apple icon and matches the browser theme color", () => {
        const document = new DOMParser().parseFromString(html, "text/html");
        expect(document.querySelector('link[rel="manifest"]')?.getAttribute("href")).toBe(
            "/manifest.webmanifest",
        );
        expect(document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href")).toBe(
            manifest.icons[0].src,
        );
        expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
            manifest.theme_color,
        );
        expect(document.querySelector('meta[name="viewport"]')).not.toBeNull();
    });
});
