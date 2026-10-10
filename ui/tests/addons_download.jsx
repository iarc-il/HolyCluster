import Download from "@/components/addons/Download.jsx";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

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
                json: async () => ({ artifact: { location: `/catserver/artifacts/${target}` } }),
            };
        }),
    );
    render(<Download />);
    expect(screen.getByRole("status").querySelector("svg.animate-spin")).not.toBeNull();
    expect(screen.queryByText(/upcoming/i)).toBeNull();
    finish();
    const link = await screen.findByRole("link", { name: `Download for ${platform}` });
    expect(link.getAttribute("href")).toBe(`/catserver/artifacts/${platform.toLowerCase()}`);
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
