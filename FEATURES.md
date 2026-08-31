# OrbitWatch — Feature Documentation

PS-04 | Space Technology | Internal Hackathon 2026

This document explains everything implemented in OrbitWatch: what each feature does, how it works under the hood, and — where it matters — the honest limitations of the approach. It's organized so you can skim section headers for a demo talking-point outline, or read a section in full for the technical detail behind it.

---

## 1. Home Page

A landing screen (logo + "OrbitWatch" wordmark + tagline + **Enter Dashboard** button) that opens before the dashboard. The 3D globe is already mounted and rendering underneath it from the first frame — clicking Enter is a pure CSS fade, not a page reload or a second Cesium initialization, so there's no loading lag at the moment that matters most in a live demo.

The logo (pulsing dot + a slowly-rotating dashed ring with an orbiting marker) is built entirely from CSS, reusing the same accent-blue pulse already used in the sidebar — no external image asset required.

**Files:** `src/components/HomePage.jsx`, home-page styles in `src/styles.css`

---

## 2. Live Orbital Data

### 2.1 Data source

Real TLEs (Two-Line Elements) fetched directly from **CelesTrak's GP API**, no auth, no paid tier:

| Group | Type | Cap | Source |
|---|---|---|---|
| Fengyun-1C debris | debris | 15 | `INTDES=1999-025` (no named GROUP exists for this field — queried by international designator instead) |
| Cosmos 2251 debris | debris | 15 | `GROUP=cosmos-2251-debris` |
| Iridium 33 debris | debris | 15 | `GROUP=iridium-33-debris` |
| Starlink | satellite | 40 | `GROUP=starlink` |
| Stations (ISS, Tiangong, ...) | satellite | 15 | `GROUP=stations` |
| Science (Hubble, ...) | satellite | 15 | `GROUP=science` |

Each group is capped because conjunction detection is O(pairs), and debris fields in particular cluster tightly in altitude — raw object count matters more than pair count for keeping the browser responsive.

Requests are routed through a local dev-server proxy (`/celestrak-proxy`, configured in `vite.config.js`) rather than hitting `celestrak.org` directly, because CelesTrak doesn't send CORS headers — a direct browser `fetch()` fails silently otherwise. The proxy rewrites `/celestrak-proxy/*` to `https://celestrak.org/NORAD/elements/*` server-side, which sidesteps CORS entirely since it becomes a server-to-server request. **This only applies during `npm run dev`/`npm run preview` — a static production deploy would need an equivalent server-side proxy or a hosted CORS-passthrough.**

### 2.2 Caching + "fetch as soon as it's actually fresh"

CelesTrak throttles repeat downloads of *unchanged* data per group per IP, and — usefully — tells you exactly why: a rejected request returns a body like:

> `GP data has not updated since your last successful download of GROUP=starlink at 2026-08-30 13:51:51 UTC. Data is updated once every 2 hours.`

Rather than guessing a fixed cache TTL, `fetchGroup()` in `src/lib/orbital.js` **parses that message** and schedules the next fetch attempt right after the real update window closes (plus a 5-minute safety buffer) — so a refresh is picked up as close to "as soon as it exists" as possible, without wasting requests we already know would be rejected. The very first load (no learned schedule yet) falls back to a conservative 2.25h TTL until it learns the real cadence from a rejection.

Cache lives in `localStorage`, keyed per group, alongside the learned "next eligible" timestamp.

### 2.3 Resilience

If a live fetch fails (network down, rate-limited, CelesTrak outage), `fetchObjects()` falls back to the last successfully-cached data for that group and flags it `stale`. If there's no cache at all for a group, it degrades to zero objects for that group rather than crashing. The dashboard always renders — worst case, the sidebar shows "⚠ Live orbital data unavailable" or "⚠ Showing cached TLE data," never a blank screen.

**Files:** `src/lib/orbital.js` (`fetchObjects`, `fetchGroup`, `parseThrottleMessage`)

---

## 3. Demo Mode

A network-free alternative to live data, for reliable testing and demoing without depending on CelesTrak being reachable at that exact moment.

### 3.1 Two scenarios

| Scenario | Composition | Verified conjunctions |
|---|---|---|
| **Mixed Orbital Field** | 10 satellites (3 orbital shells: Starlink-like, station-like, sun-synchronous) + 20 debris (3 real historical fields: Cosmos 2251, Iridium 33, Fengyun-1C) | SIM-IRIDIUM-A/D: 1.92 km (critical) · SIM-COSMOS-A/B: 6.84 km (warning) · SIM-FENGYUN-A/B: 4.63 km (warning) |
| **ASAT Debris Field** | 5 satellites for context + 20 debris, all from the real 2007 Fengyun-1C anti-satellite test field | SIM2-FENGYUN-A/B: 1.62 km (critical) · SIM2-FENGYUN-A/L: 6.94 km (warning) · SIM2-FENGYUN-B/L: 5.32 km (warning) |

Both use **real historical orbital elements** as a base (not fabricated), cloned with small, fixed (not randomized-per-load) RAAN/mean-anomaly offsets to spread objects around realistically while guaranteeing a few pairs pass close enough to trigger detection. Every distance above was independently verified by running the *actual* conjunction-detection algorithm against the generated TLEs in Node before being committed to source — not hand-picked and hoped for.

Because the layout is fixed rather than regenerated with `Math.random()` on each load, the same objects and the same conjunctions appear every time — reliable for a live demo or repeated testing, at the cost of variety across sessions.

### 3.2 Why a fixed epoch matters here

Demo TLEs use a fixed epoch (1 Jan 2024). SGP4 propagation error compounds the further you propagate from a TLE's epoch — the app anchors its simulation clock *and* its conjunction-detection window to that epoch for demo data (rather than wall-clock "now," which is what live data uses, since live TLEs' epoch tracks real time closely). Getting this backwards was an actual bug caught and fixed earlier in this project — propagating a 2024 TLE against a 2026 "now" produced a closest-approach error of over 14,000 km on what should have been a 7 km conjunction.

### 3.3 Guided "Play Demo"

A **▶ Play Demo** button (visible only in Demo mode) auto-focuses the most severe conjunction in the current scenario, holds on it for a few seconds, then returns to the overview — a self-driving showcase for a recorded video or a moment when you don't want to be clicking live. Deliberately kept to two beats rather than a long scripted tour, so it doesn't depend on a chain of camera-fly animations completing exactly on schedule. **⏹ Stop** cancels it at any point.

**Files:** `src/lib/orbital.js` (`DEMO_SCENARIOS`), `src/hooks/useCesium.js` (`switchDataSource`, `setDemoScenario`, `playDemo`, `stopDemo`)

---

## 4. Conjunction Detection

### 4.1 Two-pass search

For every candidate pair of tracked objects, over a rolling window from 1 hour in the past to 48 hours ahead:

1. **Coarse pass** — sample separation every 90 seconds across the whole window to find the approximate time of closest approach.
2. **Refine pass** — if that coarse minimum drops under 50 km (the "candidate" threshold), zoom in with 1-second steps in a ±180s window around it to pin down the true time of closest approach (TCA) and true miss distance.

This two-pass design exists because full-precision, full-pairwise coverage isn't tractable in-browser — the refine step (the expensive one) only runs on pairs that already look plausible.

### 4.2 Pre-filtering

Before either pass runs, pairs are filtered by **perigee/apogee altitude-band overlap** (computed cheaply from mean orbital elements) — two objects whose altitude ranges can't possibly overlap within the candidate threshold are skipped entirely. This is what keeps the algorithm from being O(n²) at full cost.

### 4.3 Performance

The whole computation runs **async and yields every 25 pairs** (`await new Promise(resolve => setTimeout(resolve, 0))`) so it never blocks the UI thread for seconds at a stretch — verified at the actual live-mode object cap (~115 objects across all groups) and the demo scenario's worst case (30 objects, every pair passing the altitude prefilter): both complete in a few seconds without freezing scrubbing, toggles, or clicks.

Conjunction detection is **decoupled from the time scrubber** — it recomputes on TLE refresh and on a 15-minute wall-clock timer, never on every scrubber tick or animation frame.

### 4.4 Risk tiers

```
distance <  2 km  → critical
distance < 10 km  → warning
otherwise         → not surfaced
```

Named constants in `RISK_THRESHOLDS`, not hardcoded inline.

**Files:** `src/lib/orbital.js` (`computeConjunctions`, `prefilterPairs`, `eciDistanceKm`)

---

## 5. Estimated Collision Probability (Pc)

A conjunction's *distance* doesn't tell you its actual collision risk on its own — two objects could pass within 1 km with near-zero real chance of contact if their position uncertainty is small, or the reverse. Real conjunction-assessment tools (NASA CARA, ESA) compute a **probability of collision (Pc)** instead, and this dashboard estimates one too.

### 5.1 The formula

Standard simplified 2D encounter-plane method (the "constant density over the hard-body sphere" approximation used when the hard-body radius is small relative to position uncertainty):

```
Pc ≈ (HBR² / 2σ²) · exp(−d² / 2σ²)
```

- `d` — miss distance (from the two-pass search above)
- `σ` — combined position uncertainty, projected into the encounter plane
- `HBR` — combined hard-body radius (physical size of both objects together)

### 5.2 Where the numbers come from — and their real limitation

**TLEs carry no covariance data.** This is a genuine, documented limitation of the format, not a shortcut taken here — real agencies get position-uncertainty covariance from their own tracking pipelines, which public TLEs simply don't include. So `σ` can't come from actual measured uncertainty the way it would at NASA CARA.

Instead, `σ` is built from **published SGP4 error-growth studies**: ~1 km position error at a TLE's epoch, growing ~2 km/day thereafter, combined in quadrature per object based on how far each one has actually propagated from its own epoch by the time of closest approach. `HBR` uses the standard 20 m combined default used in the literature when real object dimensions are unknown.

**This is why the UI always labels it "Estimated Pc"** with a tooltip spelling out the assumption — never presented as a rigorous, agency-grade probability. One genuinely interesting (and correct, if counterintuitive) property worth knowing before a demo: Pc gets *smaller* as the underlying data gets staler, because more uncertainty spreads the probability mass over a larger volume, lowering the density at any single point — including near the actual miss distance. Real conjunction-assessment practice treats a very low Pc from high-uncertainty data with caution for exactly this reason, rather than reading it as "safe."

**Files:** `src/lib/orbital.js` (`estimateCollisionProbability`, `sgp4PositionSigmaKm`)

---

## 6. Avoidance Simulator (Mitigation "What-If")

On any conjunction's detail panel, a slider (−1000 m to +1000 m) simulates nudging one object along its own velocity direction and live-recomputes the resulting miss distance, Pc, and risk tier.

**This is explicitly illustrative, not a real burn simulation** — a genuine collision-avoidance maneuver would require deriving an entirely new orbit (a new TLE) from a velocity change, which is out of scope for a browser dashboard. What it actually does is take the two objects' real ECI positions/velocities at the time of closest approach (from SGP4 propagation) and displace one of them by a straight-line offset along its current velocity vector, then recompute the geometric separation. It's a fast, defensible way to show "how much margin would a small maneuver actually buy you" without pretending to be a mission-planning tool. The UI caption says so explicitly.

**Files:** `src/lib/orbital.js` (`simulateNudge`), `src/hooks/useCesium.js` (`simulateMitigation`), `src/components/ConjunctionDetail.jsx`

---

## 7. 3D Globe & Visualization

### 7.1 Earth imagery

Real satellite photography (Esri World Imagery) with a labels/borders overlay (Esri Reference/World Boundaries and Places), probed for reachability before use and falling back to Cesium's bundled offline texture (`NaturalEarthII`) if the network is down — the globe never fails to render, it just looks less detailed offline. A small credit line in the corner states which is active.

### 7.2 Trajectories

- **Orbit paths** — the full 3D ellipse for every tracked object, colored by type (blue = satellite, gray = debris) or by risk tier (orange = warning, red = critical) when involved in a conjunction. Rendered as a colored core with a dark outline so the color reads clearly against ocean, land, or cloud alike, rather than needing a dark background the way a pure glow effect would.
- **Selection highlight** — the currently-selected object's trajectory switches to a distinct white/blue-outlined material, unambiguously different from any type or risk color, and reverts correctly when deselected or when a different object is selected.
- **Ground track** — a 2D projection of the selected object's path onto Earth's surface (the sub-satellite point over one orbit), shown as a dashed white line. Scoped to the *selected* object only, not rendered for everything at once — with 30–115 objects on screen, showing every ground track simultaneously would be unreadable clutter.
- **Comet trail** — a fading recent-position trail behind the selected object as it moves, maintained as a rolling 30-point buffer updated on the same ~400ms tick as position updates.

### 7.3 Conjunction lines

A dashed line connects any pair currently in a warning/critical conjunction, colored by risk tier, updated every animation frame to track both objects' current positions.

### 7.4 Lat/long graticule

A reference grid (meridians/parallels every 30°, labeled) toggleable on demand — lets you read off the exact coordinates of a trajectory or conjunction point rather than eyeballing it against continent outlines.

### 7.5 Debris density ring

A radial chart (not a bar chart — chosen for a more distinctive, less generic look) breaking down tracked objects by altitude band, color-coded by density, with a labeled legend since the rings alone don't say which band is which.

**Files:** `src/hooks/useCesium.js` (`renderEntities`, `showGroundTrack`, `updateTrail`, `buildGraticule`), `src/lib/orbital.js` (`computeOrbitPath`, `computeGroundTrack`), `src/components/DensityRing.jsx`

---

## 8. Object Selection & Trajectory Isolation

Clicking any object — on the globe, in a list, or via a conjunction's Track button — selects it, flies the camera to it, and shows its full orbital-element breakdown (altitude, velocity, position, eccentricity, apogee/perigee, inclination, RAAN, argument of perigee, period, orbital-shape sketch, TLE epoch age) in the Info Panel.

**Isolate trajectory on select** (a toggle, on by default): while something is selected, every *other* object's trajectory hides, leaving only the selected one's highlighted path visible — going from a dense web of up to 115 orbit lines down to exactly one. Unticking it returns to the "always show everything" view; the selection highlight itself is unaffected either way.

**Files:** `src/hooks/useCesium.js` (the selection-highlight effect, the unified visibility effect), `src/components/InfoPanel.jsx`

---

## 9. Sidebar & Layout

### 9.1 Compact by default, expandable on demand

The sidebar shows only title, stats, toggles, and search by default — no permanently-visible object/conjunction list. Typing in search (or turning on **Full List**, a pin toggle) reveals a CSS-animated panel with live-filtered Conjunctions/Objects tabs beneath the search box; clearing the search, pressing Esc, or clicking outside collapses it again (skipped while pinned).

### 9.2 Independent display toggles

Satellites, Debris, Orbit Paths, Risk Colors, Risk Lines, Lat/Long Grid, Density Ring, Isolate Trajectory, Full List — each controls one concern, combined in a single visibility effect in `useCesium.js` rather than fighting over Cesium's `.show` property across several separate effects.

### 9.3 Notification bell

Replaces what used to be permanently-stacked alert cards. A bell icon in the header shows a live badge count of *undismissed* critical conjunctions; clicking it opens a popover with the same detail + Track/Dismiss actions the old stacked cards had, but claims zero screen space when closed. Pulses briefly when a genuinely new critical conjunction first appears (tracked via a "seen" set, not just "is currently critical").

### 9.4 Live/Demo switcher + scenario picker

A segmented Live Data / Demo Data control at the top of the sidebar; when Demo is active, a scenario dropdown and the Play Demo button appear beneath it.

**Files:** `src/components/Sidebar.jsx`, `src/components/NotificationBell.jsx`, `src/styles.css`

---

## 10. About / Why This Matters

An info modal (ⓘ button, top-right header cluster) explaining the real-world stakes: Kessler syndrome, and the two actual historical events this dashboard's debris fields are modeled on —

- **Fengyun-1C**, 11 Jan 2007 — China's anti-satellite missile test, 3,531 cataloged fragments (the largest debris-generating event in spaceflight history), ~2,300 still tracked today.
- **Cosmos 2251 / Iridium 33**, 10 Feb 2009 — the first accidental collision between two intact satellites, ~2,370 fragments in a single instant.

Both dates and fragment counts were verified via web search before being written into the UI, not recalled from memory. The modal also carries an "open data" badge: everything here runs on free CelesTrak + Esri data, no paid APIs — directly answering the accessibility angle from the original problem statement (smaller institutions can't afford commercial tracking tools).

**Files:** `src/components/AboutModal.jsx`

---

## 11. Data Export

A CSV export button (header icon cluster) downloads the current conjunction list — object pair, miss distance, risk level, TCA, relative velocity, estimated Pc — as a file, generated client-side via a `Blob` and a temporary anchor click. No new dependency added; a PDF/print-view path was considered and deliberately dropped in favor of this alone, since CSV already covers "a report someone could actually forward and open in a spreadsheet."

**Files:** `src/lib/orbital.js` (`conjunctionsToCSV`), `src/App.jsx` (`downloadCSV`)

---

## 12. Time Scrubber

A slider spanning −6h to +24h relative to the data's epoch anchor (not wall-clock "now" — see §3.2 for why that distinction matters), with speed controls (1×–3600×) for playback. Independent of conjunction detection's own rolling window/timer — scrubbing time back and forth changes what you *see* on the globe without triggering a conjunction recompute.

**Files:** `src/components/TimeScrubber.jsx`

---

## Architecture Overview

```
src/
  lib/orbital.js          — TLE fetch/cache, SGP4 math, conjunction detection,
                             Pc estimation, mitigation simulation, demo scenarios,
                             CSV export
  hooks/useCesium.js       — Cesium viewer lifecycle, entity rendering, all
                             per-frame updates, toggle/selection effects,
                             guided-demo orchestration
  components/
    HomePage.jsx           — landing screen
    Sidebar.jsx             — stats, search-reveal list, toggles, source/scenario switcher
    TimeScrubber.jsx        — time slider + speed controls
    InfoPanel.jsx           — selected-object orbital details
    ConjunctionDetail.jsx   — Pc + mitigation simulator for the active conjunction
    NotificationBell.jsx    — critical-conjunction badge + popover
    AboutModal.jsx          — historical context + open-data badge
    DensityRing.jsx         — debris density by altitude
  App.jsx                  — composition, CSV export trigger
  styles.css                — all styling
```

## Known Limitations (worth knowing before a Q&A)

- **Estimated Pc, not rigorous Pc** — see §5.2. This is a real, disclosed limitation of working from public TLE data, not an oversight.
- **Mitigation simulator is geometric, not a real burn** — see §6.
- **The CelesTrak proxy is dev-server-only** (`vite.config.js`'s `server.proxy`/`preview.proxy`) — a production static deploy needs an equivalent server-side proxy.
- **Demo scenarios are fixed, not regenerated per session** — a deliberate reliability tradeoff (see §3.1), not a missing feature.
- **Ground track/comet trail render for the selected object only** — an intentional declutter choice, not a performance ceiling that couldn't be raised.
