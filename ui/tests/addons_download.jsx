import Download from "@/components/addons/Download.jsx";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

function release(target) {
    const name = `catserver-v1.3.1-${target}-x86_64${target === "windows" ? ".msi" : ".AppImage"}`;
    return {
        version: "catserver-v1.3.1",
        platform: target,
        architecture: "x86_64",
        artifact: {
            location: `/catserver/artifacts/${name}`,
            name,
            sha256: "a".repeat(64),
            size: 100,
        },
    };
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

it.each(["Linux", "Windows"])("shows a spinner until %s downloads load", async platform => {
    vi.stubGlobal("navigator", { userAgent: platform });
    let finish;
    const ready = new Promise(resolve => {
        finish = resolve;
    });
    vi.stubGlobal(
        "fetch",
        vi.fn(async url => {
            await ready;
            const target = url.includes("/linux/") ? "linux" : "windows";
            return {
                ok: true,
                headers: new Headers({ "x-catserver-upstream": "b".repeat(64) }),
                json: async () => release(target),
            };
        }),
    );
    render(<Download />);
    expect(screen.getByRole("status").querySelector("svg.animate-spin")).not.toBeNull();
    expect(screen.queryByText(/upcoming/i)).toBeNull();
    finish();
    const link = await screen.findByRole("link", { name: `Download for ${platform}` });
    const url = new URL(link.getAttribute("href"), window.location.origin);
    expect(url.pathname).toBe(release(platform.toLowerCase()).artifact.location);
    expect(url.searchParams.get("download_policy")).toBe("2");
    expect(url.searchParams.get("sha256")).toBe("a".repeat(64));
    expect(url.searchParams.get("upstream")).toBe("b".repeat(64));
    for (const [, options] of fetch.mock.calls) expect(options).toEqual({ cache: "no-store" });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(2);
});

it("stops loading and shows unavailable when requests fail", async () => {
    vi.stubGlobal("navigator", { userAgent: "Linux" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    render(<Download />);
    await screen.findByText("Linux download unavailable");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/upcoming/i)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
});
