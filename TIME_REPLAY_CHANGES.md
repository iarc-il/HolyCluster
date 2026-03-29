# Playback Feature — Technical Change Summary

**Author:** Dani
**Branch:** `Dani`
**Last updated:** 2026-03-28
**Status:** Local development complete — pending team review and deployment

---

## Overview

This change introduces a **Playback** feature (also referred to as "Past Spots Motion View") to HolyCluster. It allows operators to replay historical DX spot activity like a movie: a fixed-width time window slides through a user-selected historical period, showing exactly what was spotted at any past moment.

Key properties:
- Supports up to **72 hours** of history
- All existing filters (band, mode, continent, callsign) work normally during playback
- The user can scrub to any point by dragging the timeline arrow
- No live data or existing functionality is affected when not in playback mode

---

## Architecture

### Data flow in playback mode

```
User presses ▶
    → handle_load() computes start_time / end_time from "From" / "Until" settings
    → fetch GET /spots?start_time=X&end_time=Y
    → spots stored in replay_spots (separate from live WebSocket spots)
    → setInterval advances current_frame_start by step_size every playback_speed seconds
    → useSpotFiltering filters replay_spots to [current_frame_start, current_frame_start + window_duration]
    → map and table update normally via existing rendering pipeline
```

### Fallback (for local dev without backend deployment)
If `/spots` returns HTML (endpoint not yet deployed), `useReplay` automatically filters the already-loaded live WebSocket spots by the requested time range. This allows UI development without a running backend.

---

## Files Changed

### 1. `backend/api/src/api/main.py`

Added one new REST endpoint — no existing endpoints were modified:

```
GET /spots?start_time=<unix_float>&end_time=<unix_float>
```

- Returns up to **75,000 spots** within the requested time range, ordered newest first.
- Validates that `end_time > start_time` and that the range does not exceed **72 hours**.
- Reuses the existing `cleanup_spots()` helper and `HolySpot` SQLModel — no schema changes.

```python
@app.get("/spots")
async def get_spots(start_time: float, end_time: float):
    if end_time <= start_time:
        raise HTTPException(400, "end_time must be after start_time")
    if end_time - start_time > 86400 * 3:
        raise HTTPException(400, "Time range cannot exceed 72 hours")
    async with async_session() as session:
        query = (
            select(HolySpot)
            .where(HolySpot.timestamp >= start_time, HolySpot.timestamp <= end_time)
            .order_by(desc(HolySpot.timestamp))
            .limit(75000)
        )
        return cleanup_spots((await session.execute(query)).scalars())
```

---

### 2. `ui/vite.config.js`

Added proxy entry for `/spots` for local development. Points to `spots_server.py` running on `localhost:8001`:

```js
"/spots": { target: "http://localhost:8001" },
```

> **Deployment note:** Once the backend endpoint is deployed to the production server, this proxy entry should be changed to point to the production server, identical to the other proxy entries.

---

### 3. `backend/spots_server.py` *(new file)*

A minimal standalone FastAPI server for local development only. Connects directly to PostgreSQL (either local Docker or via SSH tunnel) and serves only the `/spots` endpoint. This allows full playback testing without running the full API stack.

**Setup:**
```
pip install fastapi uvicorn asyncpg sqlmodel python-dotenv
python spots_server.py   # runs on http://localhost:8001
```

Reads `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST_LOCAL` (default: `localhost`), `POSTGRES_PORT_LOCAL` (default: `15432`) from `.env`.

---

### 4. `ui/src/hooks/useReplay.jsx` *(new file)*

A React context (`ReplayContext` / `ReplayProvider`) that owns all playback state and logic.

**State:**

| State | Type | Description |
|---|---|---|
| `is_replay_active` | bool | Whether playback mode is on |
| `replay_spots` | array | All spots fetched for the selected range |
| `replay_config` | object | `{ start_time, end_time, window_duration, step_size, playback_speed }` |
| `current_frame_start` | number | Unix timestamp of the current window start |
| `is_playing` | bool | Whether the interval is running |
| `is_loading` | bool | Whether a fetch is in progress |
| `error` | string\|null | Error message if fetch failed |

**Actions:**

| Action | Description |
|---|---|
| `load_replay(config)` | Fetches `/spots`, normalizes data, initializes state |
| `play(config, frame_start)` | Starts `setInterval` playback engine |
| `pause()` | Stops the interval |
| `step_forward()` | Advances one step, pauses |
| `step_backward()` | Retreats one step, pauses |
| `seek(timestamp)` | Jumps to any frame, pauses |
| `exit_replay()` | Clears all state, returns to live mode |

**Spot normalization on load:**
- Band values mapped to labels: `2` → `"VHF"`, `0.7` → `"UHF"`, `<1` → `"SHF"`
- Mode `"DIGITAL"` normalized to `"DIGI"`
- DXCC country names shortened via `shorten_dxcc()`
- Replay spots assigned unique IDs starting at `1,000,000` (avoids collisions with live spot IDs)
- Spots with unknown modes or continents are filtered out

**Integration:** `ReplayProvider` is mounted inside `SpotDataProvider` (in `useSpotData.jsx`) and receives `raw_spots` (live WebSocket spots) for the fallback mechanism.

---

### 5. `ui/src/hooks/useSpotData.jsx`

Restructured to integrate the replay provider:

- `SpotDataProvider` wraps children in `<ReplayProvider live_spots={raw_spots}>`
- New inner component `SpotDataInner` switches the spot source:
  - **Live mode:** `raw_spots` from WebSocket
  - **Playback mode:** `replay_spots` from `useReplay`

No changes to the public API of `useSpotData`.

---

### 6. `ui/src/hooks/useSpotFiltering.js`

Updated the time-window filter condition to handle playback mode:

```js
// Live mode (unchanged):
const is_in_time_limit = current_time - spot.time < filters.time_limit;

// Playback mode (new):
const is_in_time_limit =
    spot.time >= current_frame_start &&
    spot.time < current_frame_start + window_duration;
```

`is_replay_active`, `current_frame_start`, and `replay_config` added to the `useMemo` dependency array.

---

### 7. `ui/src/components/SidePanel.jsx`

- Added a **Playback** tab (large green play-triangle icon, color `#00FF00`) to the tab bar alongside Filters, Band Bar, Heatmap, and DXpeditions.
- Renders `<ReplayControls />` when the Playback tab is active.
- Imports `useReplay` to pass replay state to child components.

---

### 8. `ui/src/components/ReplayControls.jsx` *(new file)*

The main UI panel for the playback feature. Fully self-contained.

**Layout:**

```
┌─────────────────────────────────────┐
│  [Gear icon]  or  [✕ Exit]  (top-right, floating)
│                                     │
│  [Settings panel - collapsible]     │
│    Window / Step / Speed dropdowns  │
│                                     │
│  Until: [dropdown]                  │  ← hidden during playback
│                                     │
│  ┌─ Time axis area ──────────────┐  │
│  │  [Past Spots / Motion View]   │  │  ← shown before load
│  │  [▶ to start]                 │  │  ← shown before load
│  │                               │  │
│  │  [Loading spinner + text]     │  │  ← shown while loading
│  │                               │  │
│  │  [UTC date/time label] ────►  │  │  ← shown during playback
│  │                          │    │  │
│  │  Green vertical axis  ◄──┤    │  │
│  │  (with bright segment     │    │  │
│  │   for current window)     │    │  │
│  └───────────────────────────────┘  │
│                                     │
│  From: [dropdown]                   │  ← hidden during playback
│                                     │
│  [⏮] [⏪] [▶/⏸] [⏩] [⏭] [✕]    │  ← controls bar
└─────────────────────────────────────┘
```

**Settings (persisted to localStorage):**

| Setting | Options | Default | Description |
|---|---|---|---|
| From | 0–168h ago | 20h | How far back the playback range starts |
| Until | 0–168h ago | 7h | How far back the playback range ends |
| Window | 5/15/30/60 min | 15 min | Width of the sliding time window |
| Step | 1/5/15/30 min | 5 min | How much to advance per frame |
| Speed | 0.5/1/2/5 s | 1 s | Time between frames |

All settings survive page refresh via `use_object_local_storage`.

**Time axis:**
- Vertical green line (`#22c55e`, full opacity) with white tick marks at every hour and half-hour
- Hour labels in `-Nh` format (e.g. `-7h`, `-8h`, ...)
- Bright green segment (10px wide) shows the current window position on the axis
- Horizontal arrow line (4px) with arrowhead points to the window midpoint
- UTC date and time displayed next to the arrow

**Arrow drag scrubbing:**
- Hovering over the arrow **pauses playback** so it holds still (resumes if mouse leaves without clicking)
- Click and drag the arrow up/down to seek to any point in time
- Drag is offset-based: the arrow stays in place at mousedown and moves relative to drag distance
- Releasing the mouse leaves playback paused at the new position
- Pressing ▶ resumes from the dragged position

**Loading state:**
- While fetching, shows an animated spinner with "Loading / spots…" text on a blue background badge, matching the app's visual style

**Exit:**
- Red ✕ button at top-right of the panel (replaces gear icon during playback)
- Red ✕ button also in the bottom controls bar
- Both call `exit_replay()` which returns to live mode

---

### 9. `ui/src/components/SvgMap.jsx` and `ui/src/components/CanvasMap/`

Updated the **day/night solar terminator** to follow playback time:

- During playback, the terminator is calculated at the **midpoint of the current frame window**
- During live mode, uses `new Date()` as before
- Prevents the night shadow from being stuck at the time playback was loaded

```js
const display_time = is_replay_active && current_frame_start !== null
    ? new Date((current_frame_start + (replay_config?.window_duration ?? 0) / 2 * 1000))
    : new Date();
```

---

## What Was NOT Changed

- No database schema changes
- No WebSocket logic
- No existing API endpoints modified
- No UI outside SidePanel / ReplayControls
- No deployment configuration (nginx, Docker, etc.)
- No changes to any collector logic

---

## Local Development Setup

Three terminals are required:

**Terminal 1 — Docker (local database + collector):**
```
cd backend
docker compose up postgres valkey collector
```

**Terminal 2 — Spots server:**
```
cd backend
python spots_server.py
```

**Terminal 3 — Vite dev server:**
```
cd ui
npm run dev
# Open http://localhost:5173
```

> The local PostgreSQL database accumulates spots from the moment Docker starts. Do not restart Docker — each restart resets the accumulated history. After ~24h of continuous running, 24h of history is available for playback.

---

## Deployment Checklist (for the team)

- [ ] Deploy `backend/api/src/api/main.py` — contains the new `/spots` endpoint
- [ ] Update `ui/vite.config.js` `/spots` proxy to point to the production server (same as other proxy entries)
- [ ] Verify `GET /spots?start_time=X&end_time=Y` returns a JSON array (not HTML)
- [ ] Confirm the production database has sufficient history (retention is currently 14 days)
- [ ] `backend/spots_server.py` is a local dev tool only — **do not deploy**
- [ ] No database migrations required

---

## Testing

1. Open SidePanel → Playback tab (green ▶ icon)
2. Set From = `24h ago`, Until = `0h ago`, Window = `15 min`, Step = `5 min`, Speed = `1s`
3. Press ▶ — loading spinner appears, then playback begins automatically
4. Verify the map updates every second showing different spots
5. Hover over the arrow — playback freezes; move mouse away — playback resumes
6. Click and drag the arrow — verify scrubbing works and playback stays paused on release
7. Press ⏪ / ⏩ — verify single-frame step works
8. Press ⏮ / ⏭ — verify jump to start / end works
9. Press ✕ (top-right or controls bar) — verify live spots return to normal
10. During playback, toggle band / mode / continent filters — verify they apply immediately
11. During playback, verify the day/night terminator moves with the playback time
12. Set From = `72h ago` and press ▶ — verify load completes and 72h of data is available

---

## Additional Changes — 2026-03-29

The following features were added in the session following the initial playback release (commit `3a21698`).

---

### 1. Historical Callsign Search

A toggle and "From" range selector were added to the search bar, enabling operators to search for all spots of a specific callsign over a historical time range (not just the current live window).

**How it works:**
- A **toggle** next to the search box enables historical mode; the **From** dropdown selects how far back to look (options: 6h / 12h / 24h / 2D / 3D)
- While the toggle is off, the dropdown is grayed out and the search box works as before (live filter only)
- When enabled and a callsign is typed, a fetch is issued to `GET /spots?callsign=<prefix>&start_time=...` with a 300ms debounce
- Results bypass the normal 1-hour time window filter — all fetched spots are shown
- A spinner overlays the right side of the search box while loading
- Pressing ✕ clears the query and exits search mode
- Parsing of large responses is done in a **Web Worker** (`ui/src/workers/spotsParser.js`) to avoid blocking the main thread

**Backend change (`backend/api/src/api/main.py`):**
- Added optional `callsign` parameter to `GET /spots` — performs a prefix `ilike` filter on `dx_callsign`
- Added optional `limit` parameter (default and max: 75,000)

**Files changed:** `CallsignSearch.jsx`, `useReplay.jsx`, `useSpotFiltering.js`, `workers/spotsParser.js` (new), `backend/api/src/api/main.py`

---

### 2. My Modes Settings Tab

A new **"My Modes"** tab was added to the Settings panel, mirroring the existing "My Bands" tab.

- Operators can individually **disable modes** (SSB, CW, FT8, FT4, DIGI, RTTY)
- Disabled modes are hidden from the mode buttons in the left column
- A **"Show disabled modes"** toggle re-displays them without re-enabling them
- Disabled modes are **excluded from alert sounds** (see alert fix below)

**Files changed:** `settings/Modes.jsx` (new), `settings/Settings.jsx`, `useSettings.jsx`, `LeftColumn.jsx`

---

### 3. Alert Sound Fix — Settings-Disabled Bands and Modes Never Alert

Previously, a spot matching an alert filter would trigger the alert sound even if its band or mode was disabled in Settings.

**Fix:** Alert gate added in `useSpotFiltering.js`:
```js
&& !settings.disabled_bands[spot.band]
&& !settings.disabled_modes?.[spot.mode]
```
Settings-disabled bands/modes are fully excluded from alerts. Band-bar-unchecked bands still alert (that is deliberate — the band bar is a display filter, not a preference setting).

**File changed:** `useSpotFiltering.js`

---

### 4. Per-Spot Independent New-Spot Highlight

New arriving spots are highlighted in the table. Previously the highlight used a shared data structure that caused the **entire visible list to highlight simultaneously** when any spots arrived.

**Fix:** Each spot object now carries its own `arrival_time` field, stamped at creation:
- `null` for spots from the initial load (no highlight)
- `Date.now()` for spots arriving via live WebSocket updates

Each table row independently runs its own timers:
- **Instant** solid highlight on arrival (no fade-in transition)
- **2 seconds** solid
- **5-second ease-out fade** to normal
- **Off at 7 seconds**

The CSS transition (`background-color 5s ease-out`) is only applied during the fade phase (`is_fading === true`), so the highlight snaps on immediately and fades out slowly.

**Files changed:** `useSpotWebSocket.js`, `useSpotData.jsx`, `SpotsTable.jsx`

---

### 5. DXpeditions — QRZ.com Links

Clicking a callsign in the DXpeditions panel now opens the operator's QRZ.com page in a new tab.

**File changed:** `DXpeditions.jsx`

---

### 6. "Single Spot per Station" Toggle Moved to Search Bar

The **"Single spot per station"** toggle was moved from Settings → General to the search bar (far right, always visible). The two-line label "Single spot / per station" makes it compact enough to fit.

**Files changed:** `CallsignSearch.jsx`, `settings/General.jsx`

---

### Deployment Notes (2026-03-29 additions)

- The `callsign` prefix filter on `/spots` requires the updated `backend/api/src/api/main.py` — same file as the original playback endpoint, no new files needed on the backend
- `ui/src/workers/spotsParser.js` is a frontend-only Web Worker — no backend deployment required
- No database schema changes
