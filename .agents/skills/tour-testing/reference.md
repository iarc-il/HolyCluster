# Tour Testing Reference

Use this file only when exact commands or snippets are needed.

## App Setup

Install UI dependencies if needed with `npm ci` from `ui`.

Start the Vite dev server from `ui` with:

```bash
npm run dev -- --host 127.0.0.1
```

Confirm the app loads:

```bash
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:5173/
```

## Headed Browser

```js
const browser = await chromium.launch({
    executablePath: "/opt/google/chrome/chrome",
    headless: false,
    slowMo: 80,
    args: ["--no-sandbox"],
});
```

## Fresh Context

```js
const context = await browser.newContext({ viewport: { width, height } });
await context.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("first_launch", "false");
    localStorage.setItem("active_view", "0");
});
```

## Start A Chapter

```js
await page.goto("http://127.0.0.1:5173/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
});
await page.waitForSelector("[data-tour='app-shell']", { state: "attached" });

const launcherVisible = await page.locator("[data-tour='tour-launcher'] > button").isVisible().catch(() => false);
if (!launcherVisible) {
    await page.click("[data-tour='top-bar-left-menu'] button");
    await page.waitForSelector("[data-tour='tour-launcher'] > button", { state: "visible" });
}

await page.click("[data-tour='tour-launcher'] > button");
await page.click(`button[aria-label="Select ${chapterTitle} tour"]`);
await page.click('button[aria-label="Start tour"]');
await page.waitForSelector("#joyride-tooltip-title", { state: "visible" });
```

## Collect Step State

```js
async function getStepState(page, expectedSteps) {
    await page.waitForTimeout(100);
    return page.evaluate(steps => {
        function isVisible(selector) {
            const el = document.querySelector(selector);
            if (!el) return false;
            const style = getComputedStyle(el);
            return style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0;
        }

        function rect(selector) {
            const el = document.querySelector(selector);
            if (!el) return null;
            const box = el.getBoundingClientRect();
            return {
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
                right: box.right,
                bottom: box.bottom,
            };
        }

        const tooltip = document.querySelector(".react-joyride__tooltip");
        const index = tooltip ? Number(tooltip.getAttribute("data-joyride-step")) : null;
        const target = index == null ? null : steps[index]?.target;

        return {
            index,
            title: document.querySelector("#joyride-tooltip-title")?.textContent ?? null,
            content: document.querySelector("#joyride-tooltip-content")?.textContent ?? null,
            target,
            targetVisible: target ? isVisible(target) : null,
            tooltipRect: rect(".react-joyride__tooltip"),
            backRect: rect("#react-joyride-portal [data-testid='button-back']"),
            primaryRect: rect("#react-joyride-portal [data-testid='button-primary']"),
            hasBack: Boolean(document.querySelector("#react-joyride-portal [data-testid='button-back']")),
            hasPrimary: Boolean(document.querySelector("#react-joyride-portal [data-testid='button-primary']")),
            viewport: { width: innerWidth, height: innerHeight },
        };
    }, expectedSteps);
}
```

## Layout Helper

```js
function rectFullyInside(rect, viewport) {
    if (!rect) return true;
    return rect.x >= 0 && rect.y >= 0 && rect.right <= viewport.width && rect.bottom <= viewport.height;
}
```

## Common Actions

```js
await page.click("#react-joyride-portal [data-testid='button-primary']");
await page.click("#react-joyride-portal [data-testid='button-back']", { timeout: 5000 });
await page.click("[data-tour='spot-row-dx-callsign']", { button: "right" });
await page.hover("[data-tour='filter-options-trigger-bands-20']");
```

If a real Back click is outside the viewport, record that as a failure before using a DOM click to continue collecting diagnostics:

```js
await page.screenshot({ path: "/tmp/opencode/tutorial-offscreen-button.png", fullPage: true });
await page.evaluate(() => {
    document.querySelector("#react-joyride-portal [data-testid='button-back']")?.click();
});
```

## Test Commands

```bash
npx biome check src/components/tour/WebsiteTour.jsx src/components/tour/tour_chapters.jsx tests/website_tour.jsx tests/tour_chapters.js
npx vitest run tests/website_tour.jsx tests/spot_context_menu_tour.jsx tests/tour_chapters.js tests/map_controls_tour.jsx
```
