# OrbitWatch — Space Debris Tracking & Conjunction Risk Dashboard

PS-04 | Internal Hackathon 2026 | Space Technology

A React + CesiumJS dashboard that tracks satellites and debris in real time,
propagates their orbits using SGP4, and predicts close-approach ("conjunction")
events with risk scoring — driven entirely by live CelesTrak TLE data.

## Run it

```bash
npm install
npm run dev
```

Opens automatically at http://localhost:5173

## Build for production / demo video

```bash
npm run build
npm run preview
```

## Features

- 3D Earth globe (CesiumJS) with real satellite imagery (Esri World Imagery +
  labels), falling back to a bundled offline texture if the network is down
- Live TLE data from CelesTrak GP (Fengyun-1C debris, Cosmos 2251 debris,
  Iridium 33 debris, Starlink), cached locally with a stale-data indicator
  if a refresh fails
- Real-time SGP4 orbital propagation via satellite.js
- Two-pass conjunction detection (coarse scan + refined time-of-closest-
  approach) across a rolling −1h to +48h window, recomputed on TLE refresh
  and every 15 minutes of wall-clock time — decoupled from the time scrubber
- Risk tiers: critical (< 2 km), warning (2–10 km)
- Red dashed lines connecting at-risk object pairs
- Time-scrubbing slider (−6h to +24h) + speed controls (1×–3600×)
- Debris density-by-altitude panel
- Lat/long graticule toggle for reading off exact conjunction coordinates
- Sidebar stays compact by default; search reveals a live-filtered
  Conjunctions/Objects list beneath the search box
- Notification bell with a live critical-conjunction badge and popover
  (Track / Dismiss), replacing permanently-stacked alert cards
- Click any object for altitude / velocity / orbital elements / period

## Data source

Live orbital data comes directly from CelesTrak — see `CELESTRAK_GROUPS` in
`src/lib/orbital.js` to add/adjust tracked groups or per-group caps.

## Structure

```
src/
  lib/orbital.js        — TLE fetch/cache, SGP4 math, conjunction detection
  hooks/useCesium.js    — Cesium viewer, globe entities, refresh/recompute cycle
  components/
    Sidebar.jsx         — stats, search-reveal list, toggles, legend
    TimeScrubber.jsx    — time slider + speed controls
    InfoPanel.jsx       — selected-object details
    NotificationBell.jsx — critical-conjunction badge + popover
    DensityRing.jsx     — debris density by altitude
  App.jsx               — composition
  styles.css            — all styling
```
