# Time Replay Feature — Change Summary

**Author:** Dani
**Date:** 2026-03-26
**Branch:** `Dani`
**Status:** Local development — pending team review before deployment

---

## Overview

This change introduces a **Time Replay** feature to HolyCluster. It allows operators to replay historical spot activity like a movie: a fixed-width time window slides through a user-defined historical period, showing exactly what was spotted at any past moment. All existing filters (band, mode, continent, callsign) continue to work normally during replay.

No live server was touched. All changes are local and require team review before merging.

---

## Files Changed

### 1. `ui/vite.config.js`
- Added `secure: false` to all existing proxy entries to fix SSL certificate mismatch during local development against `holycluster-dev.iarc.org`.
- Added a new proxy entry for `/spots` pointing to `https://holycluster-dev.iarc.org`, so the frontend can reach the new historical spots endpoint when the backend is deployed.

---

### 2. `backend/api/src/api/main.py`
Added one new REST endpoint:

```
GET /spots?start_time=<unix>&end_time=<unix>
```

- Returns up to 5,000 spots within the requested time range, ordered by newest first.
- Validates that the range does not exceed 24 hours.
- Reuses the existing `cleanup_spots` helper and `HolySpot` model — no schema changes.
- No existing endpoints were modified.

---

### 3. `ui/src/hooks/useReplay.jsx` *(new file)*
A new React context (`ReplayContext` / `ReplayProvider`) that owns all replay state and playback logic.

**State managed:**
| State | Description |
|---|---|
| `is_replay_active` | Whether replay mode is currently on |
| `replay_spots` | All spots fetched for the selected time range |
| `replay_config` | `{ start_time, end_time, window_duration, step_size, playback_speed }` |
| `current_frame_start` | Unix timestamp of the current window's leading edge |
| `is_playing` | Whether the interval is running |
| `is_loading` | Whether a fetch is in progress |
| `error` | Error message string if fetch failed |

**Actions exposed:**
- `load_replay(config)` — fetches spots from `/spots`, normalizes them, sets state
- `play(config, frame_start)` — starts the `setInterval` playback engine
- `pause()` — stops the interval
- `step_forward()` / `step_backward()` — single-frame advance/retreat
- `seek(timestamp)` — jump to any frame
- `exit_replay()` — clears all replay state, returns to live mode

**Fallback:** If the `/spots` endpoint is not yet deployed (backend returns HTML), the hook automatically falls back to filtering the already-loaded live WebSocket spots by the requested time range. This allows full local testing without a running backend.

**Spot normalization:** Band values are mapped to human-readable labels (e.g. `2` → `"VHF"`), mode `"DIGITAL"` is normalized to `"DIGI"`, DXCC country names are shortened, and replay spots receive unique IDs starting at `1,000,000` to avoid collisions with live spot IDs.

---

### 4. `ui/src/hooks/useSpotData.jsx`
Restructured to integrate the replay provider cleanly:

- The outer `SpotDataProvider` now wraps its children in `<ReplayProvider live_spots={raw_spots}>`, giving the replay hook access to live spots for the fallback mechanism.
- A new inner component `SpotDataInner` consumes `useReplay` and switches the spot source:
  - **Live mode:** uses `raw_spots` from the WebSocket
  - **Replay mode:** uses `replay_spots` from the replay hook

No changes to the public API of `useSpotData`.

---

### 5. `ui/src/hooks/useSpotFiltering.js`
Updated the time-window filter condition:

- **Live mode (unchanged):** `current_time - spot.time < filters.time_limit`
- **Replay mode (new):** `spot.time >= current_frame_start && spot.time < current_frame_start + window_duration`

Added `is_replay_active`, `current_frame_start`, and `replay_config` to the `useMemo` dependency array.

---

### 6. `ui/src/components/SidePanel.jsx`
- Added a **Replay** tab (green play-triangle icon) to the existing tab bar alongside Filters, Band Bar, Heatmap, and DXpeditions.
- Renders `<ReplayControls />` when the Replay tab is active.

---

### 7. `ui/src/components/ReplayControls.jsx` *(new file)*
A self-contained sidebar panel for the replay feature.

**Layout (top to bottom):**

| Area | Description |
|---|---|
| Floating top-right | Gear icon (settings toggle) + Exit button (shown during active replay) |
| Settings panel (collapsible) | Dropdowns for Window duration, Step size, and Playback speed |
| "Until" row | Pinned to top of axis area — dropdown to select how many hours ago the replay ends |
| Time axis | Vertical green line with white hourly tick marks |
| Window segment | Bright green highlight on the axis showing the current window position |
| Arrow | Horizontal line + arrowhead pointing to the current window midpoint |
| "Press ▶ to start" | Shown when replay is not yet loaded; large, left-aligned, with inline ▶ icon |
| "From" row | Pinned to bottom of axis area — dropdown to select how many hours ago the replay begins |
| Playback controls | ⏮ ⏪ ▶/⏸ ⏩ ⏭ buttons at the bottom |

**Key behavior:**
- Pressing ▶ automatically fetches data and starts playback — no separate "Load" button required.
- ⏮/⏩ (go to start/end) also auto-load if replay is not yet active, then pause at the target frame.
- The time axis segment and arrow animate smoothly as the window advances.
- "From" and "Until" dropdowns are disabled (display only) once replay is active, showing the loaded range.

---

### 8. `ui/src/main.jsx`
- Removed a standalone `ReplayProvider` wrapper that was added early in development; the provider now lives inside `SpotDataProvider` (see §4 above), which is the correct location since it needs access to `raw_spots`.

---

## What Was NOT Changed
- No database schema changes
- No WebSocket logic
- No existing API endpoints modified
- No UI outside the SidePanel/ReplayControls
- No deployment configuration

---

## Testing (Local)
1. `cd ui && npm run dev`
2. Open SidePanel → Replay tab (green ▶ icon)
3. Set "From" = 20h ago, "Until" = 7h ago
4. Press ▶ — data loads (from live WebSocket fallback locally) and playback begins
5. Pause, step forward/back, seek via axis — all work independently
6. Press Exit — live spot data returns normally
7. All existing band / mode / continent / callsign filters continue to work during replay

---

## Deployment Notes (for the team)
- The `/spots` backend endpoint in `main.py` needs to be deployed before the feature fetches real historical data. Until then, the fallback (live WebSocket spots filtered by time) is active automatically.
- The `vite.config.js` proxy changes are dev-only and have no effect in production builds.
- Recommend testing the backend endpoint independently: `GET /spots?start_time=X&end_time=Y` should return JSON array of spots.
