import { expect, test } from "@playwright/test";

for (const width of [1280, 375]) {
    test(`CAT Control downloads at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.route("**/catserver/releases/*/x86_64", route => {
            const platform = route.request().url().includes("/linux/") ? "linux" : "windows";
            const name = `catserver-v1.3.3-${platform}-x86_64${platform === "linux" ? ".AppImage" : ".msi"}`;
            return route.fulfill({
                json: {
                    version: "catserver-v1.3.3",
                    platform,
                    architecture: "x86_64",
                    artifact: {
                        name,
                        location: `/catserver/artifacts/${name}`,
                        sha256: "a".repeat(64),
                        size: 100,
                    },
                },
            });
        });
        await page.goto("/addons");
        await expect(page.getByRole("heading", { name: "CAT Control", exact: true })).toHaveCount(
            1,
        );
        await expect(page.getByRole("link", { name: "Holy Cluster home" })).toHaveAttribute(
            "href",
            "/",
        );
        await expect(page.getByRole("img", { name: /CAT Control/ })).toHaveCount(0);
        for (const name of [
            "How it works",
            "Get started",
            "Open CAT Control",
            "Configure your radio",
        ]) {
            await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
        }
        for (const platform of ["Linux", "Windows"]) {
            await expect(
                page.getByRole("link", {
                    name: `Download CAT Control for ${platform}`,
                    exact: false,
                }),
            ).toBeVisible();
        }
        await expect(
            page.getByText(
                "CAT Control connects Holy Cluster to your radio through OmniRig or Hamlib.",
            ),
        ).toBeVisible();
        await expect(page.locator("body")).not.toContainText(/\bserver\b|We Handle the Radio/i);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true,
        );
    });
}
