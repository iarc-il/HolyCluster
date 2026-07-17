---
name: tour-testing
description: Use when testing, debugging, or fixing React Joyride app tours, especially Back button behavior, waitFor/waitForChange steps, hover popups, modals, and drag steps.
---

# Tour Testing

Use this workflow when a user asks to test, debug, or fix a guided tutorial chapter implemented with React Joyride.

## Core Rule

Do not infer tour behavior from code alone. Reproduce the tour in Playwright, observe the current tooltip title and underlying UI state, then fix only confirmed failures.

## Scope

Use this procedure for any chapter in `ui/src/components/tour/tour_chapters.jsx`.

Primary files:

- `ui/src/components/tour/tour_chapters.jsx`
- `ui/src/components/tour/WebsiteTour.jsx`
- `ui/tests/website_tour.jsx`
- `ui/tests/tour_chapters.js`

## Prepare The App

Install UI dependencies if needed with `npm ci` from `ui`.

Start the Vite dev server from `ui` with `npm run dev -- --host 127.0.0.1`.

Confirm the app loads with `curl --fail --silent --show-error --max-time 10 http://127.0.0.1:5173/`.

Use headed Chrome for manual-observable runs:

```js
const browser = await chromium.launch({
    executablePath: "/opt/google/chrome/chrome",
    headless: false,
    slowMo: 80,
    args: ["--no-sandbox"],
});
```

Use an isolated browser context for every viewport:

```js
const context = await browser.newContext({ viewport: { width, height } });
await context.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("first_launch", "false");
    localStorage.setItem("active_view", "0");
});
```

## Required Viewports

Run every chapter through these three configurations:

- Mobile: `390x844`
- Reduced desktop: `1280x900`
- Full desktop: `1800x1000`

Expected layout checks:

- Mobile should show `top-bar-left-menu`, `top-bar-right-menu`, and `mobile-main-tabs`.
- Mobile should not show direct `map-panel` and `table-panel` targets at the same time.
- Reduced desktop should show both open-menu buttons and both `map-panel` and `table-panel`.
- Full desktop should hide both open-menu buttons and show both `map-panel` and `table-panel`.

## Inspect The Chapter First

Before opening Playwright, inspect the chapter definition in `tour_chapters.jsx`.

Record each step:

- `title`
- `target`
- `placement`
- `mobilePlacement`
- `optional`
- `requires`
- `waitFor`
- `waitForGone`
- `waitForChange`
- `buttons`
- `mobileOnly` or `desktopOnly`

Identify interactive steps:

- `waitFor` steps that require opening UI.
- `waitForGone` steps that require closing UI.
- `waitForChange` steps that require toggles, tabs, sort changes, or selected states.
- Modal steps.
- Context-menu steps.
- Hover-triggered popup steps.
- Drag/drop steps.

## Workflow

1. Inspect the chapter definitions and central tour state machine.
2. Identify interactive steps: `waitFor`, `waitForGone`, `waitForChange`, hover-triggered UI, modals, context menus, and drag/drop.
3. Drive the tour in Playwright from a clean page state.
4. Assert every visible step's title, content when relevant, target visibility, tooltip/button viewport bounds, console state, and underlying UI state.
5. For each visible step with a Back button, click Back and verify both the tooltip title and underlying UI state.
6. If a step mutates app state, verify Back either keeps required state visible or explicitly undoes the mutation.
7. Add a regression test that fails before the fix and passes after.
8. Retake the relevant tour path in Playwright after the fix.
9. Run focused tour tests and formatting checks.

## Start A Chapter In Playwright

Load the app:

```js
await page.goto("http://127.0.0.1:5173/", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
});
await page.waitForSelector("[data-tour='app-shell']", { state: "attached" });
```

Open the tour launcher if it is hidden inside the left column:

```js
const launcherVisible = await page.locator("[data-tour='tour-launcher'] > button").isVisible().catch(() => false);
if (!launcherVisible) {
    await page.click("[data-tour='top-bar-left-menu'] button");
    await page.waitForSelector("[data-tour='tour-launcher'] > button", { state: "visible" });
}
```

Select and start the chapter:

```js
await page.click("[data-tour='tour-launcher'] > button");
await page.click(`button[aria-label="Select ${chapterTitle} tour"]`);
await page.click('button[aria-label="Start tour"]');
await page.waitForSelector("#joyride-tooltip-title", { state: "visible" });
```

## Collect Step State

Use DOM state, not screenshots, for assertions.

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

## Required Assertions For Every Step

For every visible step, assert:

- Tooltip title matches the expected step title.
- Tooltip content matches the expected step content when relevant.
- Current target exists and is visible unless the step is intentionally skipped.
- Tooltip rectangle is inside the viewport.
- Back button rectangle is inside the viewport when Back is present.
- Primary button rectangle is inside the viewport when Primary is present.
- No browser console errors occurred.
- Required underlying UI state exists for the step.

Examples of underlying UI state:

- Settings chapter: modal open or closed, active settings tab, `settings-modal-content` visible.
- Side Panel chapter: side panel open or closed, active side-panel tab, expected panel visible.
- Map chapter: map controls panel open or closed, toggle state attributes changed.
- Spots Table chapter: context menu open or closed, pinned row state, sort state.
- Filters chapter: modal open or closed, popup open or closed, created or moved filter counts.

## What To Verify

For every Back click, check:

- The expected previous tooltip title is visible.
- The previous step target exists and is visible.
- The tour did not disappear due to a missing target.
- Any modal, popup, menu, or dragged item is in the state the previous step needs.
- The step can be completed again after backing up.

## Back Button Procedure

For every step that shows Back:

1. Capture the current step index, title, target, and underlying UI state.
2. Click Back.
3. Wait for the tooltip to settle.
4. Assert the expected previous tooltip title is visible.
5. Assert the expected previous target exists and is visible.
6. Assert the tour did not disappear.
7. Assert any required UI state for the previous step was restored.
8. Complete the previous step again.
9. Assert the tour returns to the step where Back was tested.

Use real clicks first:

```js
await page.click("#react-joyride-portal [data-testid='button-back']", { timeout: 5000 });
```

If Playwright reports the button is outside the viewport, treat that as a real failure. Capture diagnostics before using DOM clicks to continue the rest of the sweep.

```js
await page.screenshot({ path: "/tmp/opencode/tutorial-offscreen-button.png", fullPage: true });
```

Only use DOM clicks to continue collecting more failures after recording the offscreen failure.

```js
await page.evaluate(() => {
    document.querySelector("#react-joyride-portal [data-testid='button-back']")?.click();
});
```

## Completing Steps

Use the step definition to complete each step.

If the step has a Primary button:

```js
await page.click("#react-joyride-portal [data-testid='button-primary']");
```

If the step waits for UI to appear, click the target or configured action selector:

```js
await page.click("[data-tour='top-bar-settings']");
await page.click("[data-tour='top-bar-right-menu'] button");
await page.click("[data-tour='settings-tab-bands-modes']");
```

If the step waits for a context menu, use the correct mouse button:

```js
await page.click("[data-tour='spot-row-dx-callsign']", { button: "right" });
```

If the step waits for hover UI:

```js
await page.hover("[data-tour='filter-options-trigger-bands-20']");
```

If the step waits for drag/drop, verify source and destination state before and after the drag.

## Layout Checks

Check clipping for each tooltip and button.

```js
function rectFullyInside(rect, viewport) {
    if (!rect) return true;
    return rect.x >= 0 && rect.y >= 0 && rect.right <= viewport.width && rect.bottom <= viewport.height;
}
```

Record a layout failure if:

- Tooltip is partially or fully outside the viewport.
- Back button is partially or fully outside the viewport.
- Primary button is partially or fully outside the viewport.
- Target is visible according to the DOM but covered or unreachable by the tooltip.
- Joyride crashes after applying a responsive placement.

## Clean State Rules

Use a fresh browser context for every viewport and every independent failure investigation.

Always clear these keys before starting:

- `first_launch`
- `active_view`
- `mobile_tab`
- `tour_completed_chapters`

Set `first_launch` to `false` so the Quick Start chapter does not auto-start.

Use chapter-specific state if needed:

- Set `active_view` to `0` before Side Panel runs so Filters starts active.
- Avoid carrying Settings active-tab state between runs.
- Avoid carrying filter-created state between Filters runs.

## Common Failure Modes

- A previous `waitFor` step is already satisfied, so backing to it immediately advances forward again.
- A previous target disappeared after the forward action, so Joyride closes or shows no tooltip.
- Back from a modal-opening step changes the tooltip but leaves the modal open or closes it too late.
- Back from an Apply/Create step does not undo the created item, so the previous create step is skipped or invalid.
- Back from a drag/move step does not restore the item to its original section, so the previous drag target is missing.
- Hover state stays active because the mouse is still over the trigger, causing a hover step to be skipped.
- Back does not move to the expected previous tooltip.
- Back moves to the previous tooltip but leaves required UI in the wrong state.
- Target is missing and Joyride closes or skips unexpectedly.
- Tooltip or buttons render outside the viewport.
- The step cannot be completed again after pressing Back.
- Browser console shows a React or Joyride exception.
- Tooltip placement obscures the target but buttons remain usable.
- Optional steps skip in one responsive mode but not another without clear reason.
- Step text describes a control that is not visible in that layout.

## Playwright Guidance

- Use fresh page state for independent Back cases so one broken transition does not hide another.
- Clear `localStorage` and `sessionStorage` before tour runs when persisted filters or completed tours matter.
- Move the mouse away from hover targets before testing hover-dependent steps.
- Prefer checking the tooltip heading plus DOM state, not only text visibility.
- For drag steps, verify source and destination section counts before and after Back.
- If an all-cases script times out, split the tour into early, modal, and drag sections.

## Failure Reporting

Report failures with the viewport, step title, step index, expected state, actual state, and screenshot path when useful.

High-priority failures:

- Back does not move to the expected previous tooltip.
- Back moves to the previous tooltip but leaves required UI in the wrong state.
- Back lands on a `waitFor` step that is already satisfied and immediately auto-advances.
- Target is missing and Joyride closes or skips unexpectedly.
- Tooltip or buttons render outside the viewport.
- The step cannot be completed again after pressing Back.
- Browser console shows a React or Joyride exception.

Medium-priority failures:

- Tooltip placement obscures the target but buttons remain usable.
- Optional steps skip in one responsive mode but not another without clear reason.
- Step text describes a control that is not visible in that layout.

## Fix Patterns

- For Back to a stateful wait step, reset the wait tracking so the tour does not auto-advance immediately.
- For Back from a step that opened UI, dispatch the same close/reset event the component already handles.
- For Back from a create/apply step, undo the created test item if the previous step expects an empty state.
- For Back from a move/drag step, move the item back so the previous drag target exists again.
- Keep fixes in the tour coordinator when the problem is tour state, not component behavior.

## Regression Tests After Fixes

Add or update focused tests after confirming a failure in Playwright.

Preferred commands:

```bash
cd ui
npx biome check src/components/tour/WebsiteTour.jsx src/components/tour/tour_chapters.jsx tests/website_tour.jsx tests/tour_chapters.js
npx vitest run tests/website_tour.jsx tests/spot_context_menu_tour.jsx tests/tour_chapters.js tests/map_controls_tour.jsx
```

Regression test expectations:

- Model the smallest realistic state in the test harness: modal open/closed, created filters, moved filters, and section counts.
- Assert the previous tooltip title and the app state required to proceed again.
- After Back, complete the step again to prove the tour is not stuck.
- Prefer a few end-to-end-ish tour tests over many isolated unit tests.
- Verify new tests fail before the change and pass after.
- Add or update focused tests after confirming a failure in Playwright.
- Add static chapter-definition checks in `ui/tests/tour_chapters.js` for placement, required targets, and safe interactive steps.

## HolyCluster Notes

- Chapter definitions live in `ui/src/components/tour/tour_chapters.jsx`.
- Tour state and Back handling live in `ui/src/components/tour/WebsiteTour.jsx`.
- Main regression coverage is in `ui/tests/website_tour.jsx`.
- Static chapter-definition coverage is in `ui/tests/tour_chapters.js`.

## Completion Criteria

A chapter is fully tested when all of these are true:

- Mobile, reduced desktop, and full desktop headed runs complete.
- Every visible Back button was tested.
- Every Back check returned to the expected title and visible previous target.
- Stateful steps restored or preserved the state required to proceed again.
- No tooltip or Joyride button was clipped or offscreen.
- No browser console errors occurred.
- Focused Vitest tour tests pass.
- Biome check passes for touched files.
