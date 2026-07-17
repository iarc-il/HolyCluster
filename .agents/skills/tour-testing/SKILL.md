---
name: tour-testing-merged
description: Use when testing, debugging, or fixing React Joyride app tours with a compact but thorough workflow; especially Back behavior, waitFor/waitForChange steps, hover popups, modals, context menus, and drag steps.
---

# Tour Testing Merged

Token rule: collect DOM state first. Use screenshots only for visual overlap, clipping, offscreen buttons, or layout failures.

Core rule: do not infer tour behavior from code alone. Reproduce the chapter in Playwright, observe the tooltip and underlying UI state, then fix only confirmed failures.

Use for chapters in `ui/src/components/tour/tour_chapters.jsx`.

Project files:

- `ui/src/components/tour/tour_chapters.jsx`
- `ui/src/components/tour/WebsiteTour.jsx`
- `ui/tests/website_tour.jsx`
- `ui/tests/tour_chapters.js`

Viewports: mobile `390x844`, reduced desktop `1280x900`, full desktop `1800x1000`.

Responsive layout expectations:

- Mobile shows `top-bar-left-menu`, `top-bar-right-menu`, and `mobile-main-tabs`.
- Mobile does not show direct `map-panel` and `table-panel` targets at the same time.
- Reduced desktop shows both open-menu buttons plus `map-panel` and `table-panel`.
- Full desktop hides both open-menu buttons and shows `map-panel` and `table-panel`.

## Workflow

1. Inspect the chapter steps and central tour state machine.
2. Record each step's `title`, `target`, `placement`, `mobilePlacement`, `optional`, `requires`, `waitFor`, `waitForGone`, `waitForChange`, `buttons`, `mobileOnly`, and `desktopOnly`.
3. Identify interactive steps: `waitFor`, `waitForGone`, `waitForChange`, modal, context menu, hover popup, drag/drop, create/apply, and open/close steps.
4. Drive the tour in Playwright from a clean page state for each required viewport.
5. Assert every visible step's title, relevant content, target visibility, tooltip/button bounds, console errors, and required UI state.
6. For every visible Back button, click Back, verify previous title/target/UI state, then complete forward again.
7. Add or update focused regression coverage only after confirming a failure.
8. Retake the relevant Playwright path and run focused Biome/Vitest checks.

## Clean State

- Use a fresh browser context for each viewport and independent failure investigation.
- Clear `localStorage` and `sessionStorage`.
- Set `first_launch` to `false` so Quick Start does not auto-start.
- Reset `active_view`, `mobile_tab`, and `tour_completed_chapters` when relevant.
- Avoid carrying Settings tab, active side-panel tab, hover state, modal state, context menu state, or created filter state between runs.

## Required Checks

For every visible step, verify:

- Tooltip title matches the expected step title.
- Tooltip content matches expected content when relevant.
- Target exists and is visible unless intentionally skipped.
- Tooltip, Back button, and Primary button rectangles are inside the viewport when present.
- Console has no React or Joyride errors.
- Required underlying UI state exists.

Examples of underlying UI state:

- Settings: modal open/closed, active settings tab, `settings-modal-content` visible.
- Side Panel: side panel open/closed, active tab, expected panel visible.
- Map: controls panel open/closed, toggle state attributes changed.
- Spots Table: context menu open/closed, pinned row state, sort state.
- Filters: modal open/closed, popup open/closed, created or moved filter counts.

## Back Invariant

After every Back click, verify:

- Expected previous tooltip title is visible.
- Previous target exists and is visible.
- Tour did not disappear due to a missing target.
- Modal, popup, menu, hover, created item, or dragged item state matches what the previous step needs.
- The previous step can be completed again and returns to the step where Back was tested.

Use real clicks first. If Playwright reports a Joyride button outside the viewport, record that as a real failure with diagnostics, then use DOM clicks only to continue collecting more failures.

## Known Fragile Cases

- Previous `waitFor` is already satisfied after Back and auto-advances.
- Previous target disappeared and Joyride closes or skips.
- Back from modal/open/create/apply/drag leaves UI in a state the previous step cannot use.
- Hover state stays active because the mouse remains over the trigger.
- Tooltip or Joyride buttons are clipped/offscreen.
- Optional steps differ across responsive modes without a clear reason.
- Step text describes controls hidden in that layout.
- Console shows a React or Joyride exception.

## Fix Guidance

- Keep tour-state fixes in `WebsiteTour.jsx` when the bug is tour coordination.
- Reset wait tracking when Back lands on a stateful wait step.
- Reuse existing component close/reset paths for Back from opened UI.
- Undo created or moved test items when the previous step requires the original state.
- Move dragged items back when the previous drag target must exist.
- Avoid component behavior changes when the confirmed bug is only tour coordination.

## Verification

- Add or update focused regression tests only after confirming the failure in Playwright.
- Model the smallest realistic state in the test harness.
- Assert previous tooltip title and required app state after Back.
- Complete forward again after Back to prove the tour is not stuck.
- Prefer a few end-to-end-ish tour tests over isolated unit tests.
- Verify new tests fail before the fix and pass after when feasible.
- Run focused Biome/Vitest checks for touched tour files.

Report failures with viewport, step index/title, expected state, actual state, and screenshot path only when useful.

Completion requires all relevant viewport paths, Back checks, UI-state checks, unclipped tooltip/buttons, no console errors, focused regression coverage when a bug is fixed, and Biome/Vitest passing for touched files.

Reference: load `reference.md` only when exact Playwright snippets, selectors, or command examples are needed.
