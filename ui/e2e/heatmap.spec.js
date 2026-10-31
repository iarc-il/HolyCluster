import { expect, test } from "./fixtures/tour.js";

test("heatmap bounds pixel reads and reuses drawing buffers across updates", async ({ page }) => {
    await page.goto("/");
    await page.locator('[data-tour="top-bar-right-menu"] button').click();
    await page.locator('[data-tour="side-panel-tab-heatmap"]').click();
    const selector = page.locator('[data-tour="heatmap-continent-selector"]');
    await expect(selector).toBeVisible();
    await page.evaluate(() => {
        window.heatmap_reads = [];
        window.heatmap_canvases = 0;
        const read = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = function (x, y, width, height, ...args) {
            window.heatmap_reads.push({ width, height });
            return read.call(this, x, y, width, height, ...args);
        };
        const draw = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
            if (this.canvas.closest('[data-tour="heatmap-chart"]')) {
                window.heatmap_layer = source;
            }
            return draw.call(this, source, ...args);
        };
        const create = document.createElement.bind(document);
        document.createElement = (tag, ...args) => {
            if (tag === "canvas") window.heatmap_canvases++;
            return create(tag, ...args);
        };
    });
    for (const continent of ["NA", "EU", "AS", "AF", "OC", "EU"]) {
        await selector.selectOption(continent);
    }
    const result = await page.evaluate(() => ({
        reads: window.heatmap_reads,
        canvases: window.heatmap_canvases,
    }));
    expect(result.reads.length).toBeGreaterThanOrEqual(6);
    expect(
        Math.max(...result.reads.map(({ width, height }) => width * height)),
    ).toBeLessThanOrEqual(200 * 430);
    expect(result.canvases).toBe(0);
    await expect(page.locator('[data-tour="heatmap-chart"] canvas')).toHaveJSProperty("width", 400);
    expect(
        await page.evaluate(() => {
            const layer = window.heatmap_layer;
            const pixels = layer
                .getContext("2d")
                .getImageData(0, 0, layer.width, layer.height).data;
            return pixels.some((value, index) => index % 4 === 3 && value > 0);
        }),
    ).toBe(true);
    await page.locator('[data-tour="side-panel-tab-filters"]').click();
    expect(await page.evaluate(() => window.heatmap_layer.width)).toBe(0);
    await page.locator('[data-tour="side-panel-tab-heatmap"]').click();
    await expect(selector).toBeVisible();
    await selector.selectOption("NA");
    expect(await page.evaluate(() => window.heatmap_layer.width)).toBe(200);
});
