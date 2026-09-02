# OrbitWatch — Technical Report

**Space Debris Tracking & Satellite Collision Risk Prediction Dashboard**

| | |
|---|---|
| **Problem Statement** | PS-04 — Space Debris Tracking & Satellite Collision Risk Prediction Dashboard |
| **Theme / Category** | Space Technology / Software |
| **Team** | CodeVisor — NIT Rourkela |
| **Product** | OrbitWatch |
| **Repository** | https://github.com/ahuman1684/OrbitWatch |

> **Purpose of this document.** This is a presentation-preparation reference, not user documentation. It explains *what* each feature does, *how* it is implemented, *why* each design decision was made, and *where the honest limits are*. Section 17 contains anticipated panel questions with prepared answers. If you read only two sections before facing the panel, read **§7 (Conjunction Detection)** and **§8 (Collision Probability)** — that is where the technical depth of this project actually lives.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Context](#2-problem-context)
3. [System Architecture](#3-system-architecture)
4. [Technology Stack and Rationale](#4-technology-stack-and-rationale)
5. [Data Layer — Acquisition, Caching, Resilience](#5-data-layer--acquisition-caching-resilience)
6. [Orbital Mechanics Layer](#6-orbital-mechanics-layer)
7. [Conjunction Detection](#7-conjunction-detection)
8. [Collision Probability (Pc) Estimation](#8-collision-probability-pc-estimation)
9. [Avoidance Simulator](#9-avoidance-simulator)
10. [3D Visualization Engine](#10-3d-visualization-engine)
11. [User Interface Components](#11-user-interface-components)
12. [Demo Mode](#12-demo-mode)
13. [Data Export](#13-data-export)
14. [Performance Engineering](#14-performance-engineering)
15. [Reliability and Failure Modes](#15-reliability-and-failure-modes)
16. [Known Limitations](#16-known-limitations)
17. [Anticipated Panel Questions](#17-anticipated-panel-questions)
18. [Future Roadmap](#18-future-roadmap)
19. [Appendix — Constants, File Map, Run Instructions](#19-appendix)

---

## 1. Executive Summary

OrbitWatch is a browser-based dashboard that ingests live orbital data for satellites and debris, propagates their orbits forward in time, detects upcoming close approaches ("conjunctions"), scores each by miss distance and an estimated collision probability, and renders the whole picture on an interactive 3D globe.

**The one-sentence pitch:** *A working space-traffic-awareness dashboard that runs entirely in a browser on free public data — no paid API, no server, no licence — so a student lab or a small satellite operator can have the same class of collision awareness that today effectively requires a commercial subscription.*

**What makes it defensible in front of a technical panel:**

| Claim | Why it holds up |
|---|---|
| Real orbital mechanics, not a mock | Industry-standard **SGP4** propagation via `satellite.js`, run against real **CelesTrak TLEs** |
| Real conjunction detection | Two-pass temporal search with altitude-band pre-filtering, 1-second refinement at closest approach |
| Goes beyond distance | Estimates a **collision probability (Pc)** using the simplified 2D encounter-plane method used in conjunction-assessment literature |
| Intellectually honest | Every approximation is labelled as such in the UI itself, and §16 lists limitations openly |
| Actually runs | Working prototype with live data, offline fallback, and a validated deterministic demo mode |

**Scale of the current build:** ~1,900 lines of hand-written application code (excluding dependencies), across a 577-line orbital-mechanics library, a 751-line Cesium integration hook, and eight React components.

---

## 2. Problem Context

### 2.1 Why space debris matters

Low Earth Orbit (LEO) is congested. Two events in particular created a large share of the tracked debris population, and both are modelled directly in this project:

| Event | Date | Consequence |
|---|---|---|
| **Fengyun-1C ASAT test** | 11 Jan 2007 | China destroyed its own weather satellite with a missile — **3,531 catalogued fragments**, the largest debris-generating event in spaceflight history. ~2,300 still tracked. |
| **Cosmos 2251 / Iridium 33** | 10 Feb 2009 | First accidental collision between two intact satellites — **~2,370 fragments** created in a single instant. |

The systemic worry is **Kessler syndrome**: debris density becomes high enough that collisions cascade, each generating more debris, potentially rendering orbital shells unusable for generations.

### 2.2 The accessibility gap this project targets

Conjunction assessment is a solved problem *at agency scale* — NASA CARA, ESA's Space Debris Office, and commercial providers (LeoLabs, COMSPOC) all do it well. What they have in common is cost and access barriers: proprietary tracking pipelines, paid API tiers, and licensed software.

**The gap:** a university CubeSat team, a small operator, or a classroom has no free, inspectable tool of this class. OrbitWatch targets exactly that gap — which is also why "zero paid APIs" is a design constraint, not just a cost saving.

### 2.3 Mapping to PS-04 requirements

| PS-04 asks for | OrbitWatch delivers | Section |
|---|---|---|
| Track space debris | Live CelesTrak ingest, 3 real historical debris fields + active satellites | §5 |
| Predict collision risk | Two-pass conjunction detection + estimated Pc | §7, §8 |
| Dashboard / visualization | CesiumJS 3D globe, orbit paths, ground tracks, risk colouring | §10 |
| Alerting | Notification bell with critical-conjunction badge, dismissal tracking | §11.4 |
| Reporting | CSV export of the full conjunction list | §13 |

---

## 3. System Architecture

### 3.1 High-level data flow

```
┌──────────────────────────────────────────────────────────────────────┐
│  EXTERNAL DATA (free, no auth)                                        │
│  CelesTrak GP API (TLEs)          Esri World Imagery (basemap tiles)  │
└───────────────┬──────────────────────────────┬───────────────────────┘
                │ direct browser fetch (CORS)  │ probed, with offline fallback
                ▼                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  lib/orbital.js — PURE LOGIC (no React, no DOM)                       │
│                                                                       │
│  fetchObjects()        → cache-aware TLE retrieval, throttle learning  │
│  buildSatellites()     → TLE text → satrec objects (SGP4-ready)        │
│  getPosition()         → satrec + time → ECI → geodetic → Cartesian3   │
│  computeConjunctions() → two-pass close-approach search                │
│  estimateCollisionProbability() → Pc from miss distance + σ model      │
│  simulateNudge()       → what-if avoidance geometry                    │
│  computeAltitudeDensity(), conjunctionsToCSV()                         │
└───────────────┬──────────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  hooks/useCesium.js — ORCHESTRATION + RENDERING                       │
│                                                                       │
│  • Cesium Viewer lifecycle (create / configure / destroy)              │
│  • Entity management: points, orbit polylines, conjunction lines,      │
│    graticule, ground track, comet trail                               │
│  • Animation loop (throttled to ~400 ms)                              │
│  • Refresh timer (15 min, live only)                                  │
│  • Selection, highlight, isolation, visibility effects                │
│  • Guided demo orchestration                                          │
└───────────────┬──────────────────────────────────────────────────────┘
                │  single hook return object ("cesium")
                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  App.jsx + components/ — PRESENTATION                                 │
│  HomePage · Sidebar · InfoPanel · ConjunctionDetail · TimeScrubber     │
│  NotificationBell · DensityRing · AboutModal                          │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 The architectural decision that matters most

**All orbital mathematics lives in `lib/orbital.js` as pure functions with no React and no DOM dependencies.**

Why this matters when a panel asks about design quality:

- **Testable in isolation** — the demo scenarios' conjunction distances were verified by importing `computeConjunctions` into a plain Node script and running it against the generated TLEs. That is only possible because the module has no browser dependencies.
- **Replaceable UI** — the entire Cesium layer could be swapped for a 2D map or a CLI without touching a line of physics.
- **Clear reasoning boundary** — when a number looks wrong, you know whether to debug the maths or the rendering.

The one place this boundary is deliberately crossed: `getPosition()` returns a `Cesium.Cartesian3`. This is a pragmatic concession — every consumer of that function is a renderer, and converting at the boundary avoided an extra transformation layer that would have added no value.

### 3.3 State management

No Redux, no Zustand, no Context. State lives in a single custom hook (`useCesium`) that returns one object consumed by `App.jsx` and drilled one level into components.

**Justification:** the app has exactly one screen and one logical data domain. The prop-drilling depth is 2. Introducing a state library here would add ceremony without reducing complexity. This is a defensible "right-sized" choice, not an omission.

**A subtlety worth being able to explain:** the hook maintains parallel `useRef` mirrors of several state values (`dataSourceRef`, `demoScenarioRef`, `conjunctionsRef`). This is because `setInterval` callbacks and `setTimeout` chains capture their closure at creation time — reading React state inside them would return a stale value forever. The refs give those long-lived callbacks a live view of current state.

---

## 4. Technology Stack and Rationale

| Layer | Choice | Why this and not the alternative |
|---|---|---|
| UI framework | **React 18** | Declarative state→UI mapping suits a dashboard with many independent toggles. |
| Build tool | **Vite 5** | Instant HMR, and a build output that is pure static files — no server component needed in production (§5.3). |
| 3D globe | **CesiumJS 1.114** | Purpose-built geospatial engine: a real WGS-84 ellipsoid, ECI/ECEF handling, camera controls, and imagery tiling. Three.js would have meant writing all of that from scratch. |
| Orbital propagation | **satellite.js 5** | A faithful JavaScript port of the **standard SGP4/SDP4** model — the same model the TLE format is *defined against*. Writing our own propagator would be both slower and less correct. |
| Orbital data | **CelesTrak GP API** | Free, no authentication, maintained by Dr. T.S. Kelso, and the de-facto public source for TLEs. |
| Imagery | **Esri World Imagery** | Free tile service, no key required. |

### 4.1 The "no API key anywhere" property

Worth stating explicitly to a panel, because it is unusual:

```js
Cesium.Ion.defaultAccessToken = '';   // useCesium.js
```

CesiumJS normally expects a Cesium Ion account token for its default assets. Setting it to empty and supplying our own imagery provider means **the application has zero credentials of any kind** — no `.env` file, no key rotation, no per-user quota. Anyone can clone the repository and run it immediately. That is a direct, concrete expression of the accessibility goal from §2.2.

---

## 5. Data Layer — Acquisition, Caching, Resilience

### 5.1 What a TLE actually is

A **Two-Line Element set** is a compact, fixed-column encoding of an object's orbital state at a specific instant (its *epoch*). Example:

```
ISS (ZARYA)
1 25544U 98067A   24001.50000000  .00016717  00000+0  10270-3 0  9993
2 25544  51.6400 337.6640 0007776  35.4780 324.6830 15.50377579 10
```

Fields the project actually consumes:

| Field | Location | Meaning | Used in |
|---|---|---|---|
| Epoch | Line 1, cols 19–32 | Year + fractional day of validity | Clock anchoring (§6.4), σ model (§8.3) |
| B\* drag term | Line 1, cols 54–61 | Atmospheric-drag coefficient | Displayed in InfoPanel; used internally by SGP4 |
| Inclination | Line 2, cols 9–16 | Orbital plane tilt vs equator | Display, object list |
| RAAN | Line 2, cols 18–25 | Right ascension of ascending node | Display; varied to spread demo objects |
| Eccentricity | Line 2, cols 27–33 | Orbit shape (implied leading decimal) | Apogee/perigee, altitude band |
| Arg. of perigee | Line 2, cols 35–42 | Orientation of ellipse in plane | Display |
| Mean anomaly | Line 2, cols 44–51 | Position along orbit at epoch | Display; varied for demo spread |
| Mean motion | Line 2, cols 53–63 | Revolutions per day | Period, semi-major axis |

**The critical property for §8:** a TLE contains *no uncertainty information*. There is no covariance matrix, no error bar. This is a documented limitation of the format and it directly constrains what Pc can honestly mean here.

### 5.2 Which objects are tracked

Defined in `CELESTRAK_GROUPS`:

| Group | Type | Cap | Query |
|---|---|---|---|
| Fengyun-1C debris | debris | 15 | `INTDES=1999-025` |
| Cosmos 2251 debris | debris | 15 | `GROUP=cosmos-2251-debris` |
| Iridium 33 debris | debris | 15 | `GROUP=iridium-33-debris` |
| Starlink | satellite | 40 | `GROUP=starlink` |
| Stations (ISS, Tiangong) | satellite | 15 | `GROUP=stations` |
| Science (Hubble, …) | satellite | 15 | `GROUP=science` |
| | | **≤ 115** | |

Two details worth knowing:

**Why Fengyun-1C is queried differently.** The other two debris fields have named CelesTrak groups; Fengyun-1C does not. It is queried by **international designator** (`INTDES=1999-025`), which returns the parent object plus every catalogued fragment from that launch. This was found by testing the API directly — an earlier attempt using `GROUP=1999-025` returned nothing.

**Why the caps exist.** Conjunction detection cost grows with the number of *pairs*, which is quadratic in object count. The caps keep the browser responsive (§14). Debris fields are capped hardest because fragments from one breakup cluster tightly in altitude, so they all survive the altitude pre-filter and generate real work.

### 5.3 Why the fetch is client-side, not proxied

TLEs are fetched **directly from `celestrak.org` in the browser**. CelesTrak serves `Access-Control-Allow-Origin: *`, so no proxy is required.

Earlier versions did proxy the request through the Vite dev server, on the assumption that CelesTrak sent no CORS headers. Removing that proxy fixed a production outage and is worth understanding, because the reasoning generalises.

**What went wrong.** Deployed to Render, every TLE fetch failed:

```
[vite] http proxy error: /NORAD/elements/gp.php?GROUP=starlink&FORMAT=3LE
Error: connect ETIMEDOUT 104.168.149.178:443
```

**The diagnosis.** Two facts had to be established before changing anything:

1. `celestrak.org` resolves correctly and responds `200` with `Access-Control-Allow-Origin: *` — so the CORS premise the proxy was built on was simply outdated.
2. CelesTrak enforces its per-IP request budget by **silently dropping packets, not by returning 403**. TCP connects; the HTTP request then hangs until it times out. (This was confirmed accidentally: roughly ten rapid test requests from one address were enough to trigger it, and the symptom was identical to Render's.)

**Why proxying is the wrong shape for this API.** A server-side proxy funnels *every visitor's* requests through a single IP — the host's. Against an API that budgets per IP, that concentrates the entire user base onto one budget, which exhausts almost immediately. Fetching client-side sends each request from the visitor's own address, so the budget is spread across users rather than pooled.

**The generalisable lesson, and a good answer if a panel asks about deployment:** *a proxy changes who the upstream thinks you are. Against a per-IP rate limit, that turns every user's traffic into one user's traffic.*

Removing it also eliminated the server component entirely — the build is now pure static files.

### 5.4 Cache with learned refresh timing

This is the most distinctive piece of engineering in the data layer.

CelesTrak throttles repeat downloads of *unchanged* data. Usefully, the rejection body states exactly why:

> `GP data has not updated since your last successful download of GROUP=starlink at 2026-08-30 13:51:51 UTC. Data is updated once every 2 hours.`

Rather than guessing a fixed TTL, `parseThrottleMessage()` extracts both the last-update timestamp and the real cadence with a regular expression, then schedules the next attempt for:

```
nextEligible = lastUpdate + cadence + 5-minute safety buffer
```

**The result:** new data is picked up close to as soon as it exists, without spending requests that are already known to be rejected. Before any rejection has been seen (first ever load), the system falls back to a conservative 2.25-hour TTL until it learns the real cadence.

Cache and learned schedule both live in `localStorage`, keyed per group, so different groups can be on different refresh cycles independently.

**Framing for a panel:** this is a system that *reads the API's own error message as a scheduling signal*. It is adaptive rather than hard-coded, and it is genuinely more polite to a free public service than a fixed-interval poller would be.

### 5.5 Layered fallback

Every network dependency degrades rather than failing:

| Failure | Behaviour |
|---|---|
| One group's fetch fails | That group falls back to its last cached TLEs, flagged `stale` |
| No cache for that group | That group contributes zero objects; the rest still load |
| All groups fail | Sidebar shows "⚠ Live orbital data unavailable"; dashboard still renders |
| Esri imagery unreachable | Globe falls back to Cesium's bundled `NaturalEarthII` texture |
| Live data unusable entirely | User switches to Demo Mode (§12), which needs no network at all |

An 8-second timeout (`AbortSignal.timeout(8000)`) bounds every TLE fetch; the imagery probe uses 3.5 seconds. Neither can hang the load indefinitely.

---

## 6. Orbital Mechanics Layer

### 6.1 SGP4 — the propagation model

**SGP4** (Simplified General Perturbations 4) is the analytical model that turns a TLE plus a target time into a position and velocity. It is not a simple two-body Keplerian solution — it accounts for:

- **J2, J3, J4 zonal harmonics** — Earth is an oblate spheroid, not a sphere; this causes nodal regression and apsidal precession
- **Atmospheric drag** — via the B\* term, causing orbital decay
- **Third-body effects and resonance terms** (the SDP4 deep-space branch, used automatically for periods > 225 minutes)

**Why this matters:** SGP4 is not merely *a* model — the TLE format is *defined* against it. Element values in a TLE are mean elements fitted so that, when fed through SGP4, they reproduce observations. Using any other propagator with TLE input is formally incorrect. This is a strong, specific answer if a panel asks "why not just use Kepler's laws?"

### 6.2 The coordinate-frame pipeline

Each render tick, for each object:

```
satrec + Date
   │  satellite.propagate()
   ▼
ECI position (km)  ── Earth-Centred Inertial: fixed relative to stars,
   │                  does NOT rotate with the Earth
   │  satellite.gstime() → Greenwich Mean Sidereal Time
   │  satellite.eciToGeodetic()
   ▼
Geodetic (lat, lon, alt)  ── accounts for Earth's ellipsoidal shape
   │  Cesium.Cartesian3.fromDegrees()
   ▼
Cartesian3 → rendered on globe
```

**The frame distinction is load-bearing, not pedantry.** Conjunction detection deliberately *skips* this pipeline:

```js
function eciDistanceKm(satrecA, satrecB, date) {
  const pvA = satellite.propagate(satrecA, date);
  const pvB = satellite.propagate(satrecB, date);
  const dx = pvA.position.x - pvB.position.x;  // ECI, direct
  ...
}
```

Separation between two objects is computed **directly in ECI**, because that is already the true physical 3D distance. Round-tripping through geodetic coordinates would add cost and floating-point error while answering the same question. Rendering needs geodetic (to place a point on a rotating globe); physics does not.

### 6.3 Derived orbital elements

`InfoPanel.jsx` computes elements not stored directly in the TLE, from real formulae:

```js
const meanMotionRadSec = satrec.no / 60;                    // satrec.no is rad/min
const semiMajorAxis   = Math.cbrt(MU / meanMotionRadSec**2); // a = (μ/n²)^(1/3)
const perigeeAlt      = a * (1 - e) - EARTH_RADIUS_KM;
const apogeeAlt       = a * (1 + e) - EARTH_RADIUS_KM;
```

This is **Kepler's third law** rearranged (`n² a³ = μ`), with μ = 398,600.4418 km³/s². The apogee/perigee expressions are the standard ellipse geometry `r = a(1 ± e)`, converted from geocentric radius to altitude by subtracting Earth's radius.

The same `altitudeBand()` computation drives the conjunction pre-filter (§7.2) — one formula, two consumers.

### 6.4 Epoch anchoring — and the bug that proved it necessary

SGP4 accuracy degrades as you propagate away from a TLE's epoch. The application therefore anchors its simulation clock to the **mean TLE epoch** of the loaded objects, not to wall-clock "now":

```js
export function meanEpochDate(sats) {
  const avgJd = sats.reduce((sum, s) => sum + s.satrec.jdsatepoch, 0) / sats.length;
  return julianToDate(avgJd);
}
```

**The bug this fixed is a strong story for a panel.** Demo TLEs use a fixed epoch of 1 Jan 2024. An early version anchored conjunction detection to `new Date()` — real "now," roughly 2026. Propagating those 2024 elements two years forward produced a closest-approach distance error of **over 14,000 km** on a conjunction that should have measured about 7 km. The pair was silently never flagged.

The fix distinguishes the two data sources by their epoch behaviour:

```js
const conjCenter = source === 'demo' ? meanEpochDate(sats) : new Date();
```

Live TLE epochs track real time closely, so wall-clock is correct there. Demo elements are historically fixed, so they must be anchored to their own epoch. **Takeaway line:** *"In orbital mechanics, the time you propagate to is as much an input as the elements themselves — and getting it wrong fails silently rather than loudly."*

---

## 7. Conjunction Detection

This is the algorithmic core of the project.

### 7.1 The problem

Given *n* objects, find every pair that will pass dangerously close within a rolling window from **1 hour in the past to 48 hours ahead** (49 hours total), and for each report the **time of closest approach (TCA)**, the **miss distance**, and the **relative velocity**.

The naive approach — sample every pair at fine resolution across the window — is intractable in a browser:

- Pairs: `n(n−1)/2` = **6,555** at n = 115
- Samples at 1-second resolution: 49 h × 3600 = **176,400** per pair
- Each sample requires **2 SGP4 propagations**

That is ~2.3 billion propagations. Not viable. The solution is two independent optimisations.

### 7.2 Optimisation 1 — altitude-band pre-filter

Two objects can only come close if their radial ranges overlap. Perigee and apogee radii are computed cheaply from mean elements — no propagation required:

```js
function altitudeBand(satrec) {
  const n = satrec.no / 60;                  // rad/s
  const a = Math.cbrt(MU_EARTH / (n * n));   // semi-major axis
  return [a * (1 - satrec.ecco), a * (1 + satrec.ecco)];  // [perigee_r, apogee_r]
}
```

A pair survives only if the bands overlap within the 50 km candidate margin:

```js
if (rp1 - CANDIDATE_KM <= ra2 + CANDIDATE_KM &&
    rp2 - CANDIDATE_KM <= ra1 + CANDIDATE_KM) pairs.push([i, j]);
```

Cost is **O(n)** to compute all bands, then **O(n²)** cheap arithmetic comparisons — with no propagation in the loop at all. A Starlink satellite at 550 km and a Fengyun fragment at 850 km are eliminated by two subtractions and two comparisons.

### 7.3 Optimisation 2 — two-pass temporal search

For each surviving pair:

**Pass 1 — coarse scan.** Sample separation every **90 seconds** across the full 49-hour window (1,960 samples) and record the running minimum. This locates the approximate TCA.

**Pass 2 — refinement.** Only if the coarse minimum falls under the **50 km** candidate threshold, rescan at **1-second** resolution in a **±180 second** window around the coarse minimum (361 samples) to pin down the true TCA and miss distance.

```
Separation
    │╲                                    ╱
    │ ╲          coarse samples (90 s)   ╱
    │  ╲    ●         ●         ●       ╱
    │   ╲       ●           ●          ╱
    │    ╲          ●   ●             ╱     ← coarse minimum found here
    │     ╲___________╲ ╱____________╱
    │                  V                    ← true minimum, found by refine pass
    └──────────────────┴────────────────────► time
                    ±180 s @ 1 s
```

**Why 90 seconds is safe.** A LEO object completes an orbit in ~90 minutes, so relative geometry evolves over minutes, not seconds. A 90-second grid reliably brackets the approach; the ±180 s refinement window comfortably contains the true minimum given that bracketing.

**The tuning rationale — a good answer if challenged on the constants:** the coarse step trades scan cost against the risk of stepping over a minimum; the refine window must exceed the coarse step's half-width (180 > 45) so the true minimum cannot fall outside it. The 50 km candidate gate is set well above the 10 km warning threshold so that a pair whose coarse estimate is slightly pessimistic still gets refined rather than being discarded early.

### 7.4 Complexity summary

| Stage | Cost per pair | Runs on |
|---|---|---|
| Altitude pre-filter | ~4 arithmetic ops | All `n(n−1)/2` pairs |
| Coarse pass | 1,960 samples × 2 propagations | Only band-overlapping pairs |
| Refine pass | 361 samples × 2 propagations | Only pairs with coarse min < 50 km |

The refine pass — the expensive one — runs on a small fraction of pairs. This staged filtering is what makes the whole computation viable client-side.

### 7.5 Risk classification

```js
export const RISK_THRESHOLDS = { criticalKm: 2, warningKm: 10 };
```

| Miss distance | Tier | Visual treatment |
|---|---|---|
| < 2 km | **critical** | Red, bell notification, badge count |
| 2–10 km | **warning** | Amber |
| ≥ 10 km | not surfaced | — |

These are named constants, referenced by the sidebar legend's tooltips so the UI and the logic cannot drift apart. The values are conventional screening volumes for LEO screening; they are configurable in one place.

### 7.6 Non-blocking execution

`computeConjunctions` is `async` and yields to the event loop every 25 pairs:

```js
if (idx % yieldEveryPairs === yieldEveryPairs - 1) {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
```

`setTimeout(0)` returns control to the browser's task queue, letting it process input, run animation frames, and repaint before resuming. Without this, the computation would monopolise the main thread and freeze the globe.

**Staleness guard.** Overlapping computations are handled with a monotonic token:

```js
const token = ++conjTokenRef.current;
const conj = await computeConjunctions(sats, conjCenter);
if (viewerRef.current !== viewer || token !== conjTokenRef.current) return;  // superseded
```

If the user switches data source mid-computation, the older run's results are discarded instead of overwriting the newer ones — a classic async race, explicitly handled.

**Decoupling from the scrubber.** Detection runs on TLE refresh and on a 15-minute timer — **never** on scrubber movement or animation frames. Scrubbing time changes what you *see*; it does not trigger a recompute. This is why the timeline stays smooth.

---

## 8. Collision Probability (Pc) Estimation

### 8.1 Why distance alone is insufficient

A 1 km miss distance means very different things depending on how well you know each object's position. If both are tracked to 10-metre accuracy, 1 km is comfortable. If positions are uncertain by several kilometres, 1 km is alarming. Real conjunction assessment therefore reports **probability of collision (Pc)**, not distance alone.

Adding Pc is what moves this project past "a distance calculator with a globe attached."

### 8.2 The formula

OrbitWatch uses the simplified 2D encounter-plane approximation — valid when the hard-body radius is small relative to position uncertainty, which is the regime for small debris:

```
Pc ≈ (HBR² / 2σ²) · exp(−d² / 2σ²)
```

| Symbol | Meaning | Source in code |
|---|---|---|
| `d` | Miss distance at TCA | Two-pass search (§7.3) |
| `σ` | Combined position uncertainty | SGP4 error-growth model (§8.3) |
| `HBR` | Combined hard-body radius | 20 m default (`DEFAULT_HBR_KM = 0.02`) |

```js
export function estimateCollisionProbability(satrecA, satrecB, atDate, distKm) {
  const sigmaA = sgp4PositionSigmaKm(satrecA, atDate);
  const sigmaB = sgp4PositionSigmaKm(satrecB, atDate);
  const sigma  = Math.sqrt(sigmaA * sigmaA + sigmaB * sigmaB);   // quadrature
  const pc = ((DEFAULT_HBR_KM ** 2) / (2 * sigma * sigma))
           * Math.exp(-(distKm * distKm) / (2 * sigma * sigma));
  return Math.min(pc, 1);
}
```

**Interpretation of the two factors:** the exponential is a 2D Gaussian probability *density* evaluated at the miss distance; multiplying by the hard-body cross-sectional area term converts that density into a probability of the objects actually intersecting. Uncertainties combine **in quadrature** (`√(σ_A² + σ_B²)`) because the two objects' errors are independent.

### 8.3 Where σ comes from — and the honest limitation

**TLEs contain no covariance data.** This is a documented property of the format, not an oversight in this project. NASA CARA derives σ from its own tracking pipeline's covariance; public TLEs simply do not carry that information.

σ is therefore modelled from **published SGP4 error-growth behaviour**:

```js
const SGP4_SIGMA_AT_EPOCH_KM     = 1;   // ~1 km error at epoch
const SGP4_SIGMA_GROWTH_KM_PER_DAY = 2; // growing ~2 km/day

function sgp4PositionSigmaKm(satrec, atDate) {
  const days = Math.abs(atDate - julianToDate(satrec.jdsatepoch)) / 86400000;
  return SGP4_SIGMA_AT_EPOCH_KM + SGP4_SIGMA_GROWTH_KM_PER_DAY * days;
}
```

Note this is computed **per object**, from each object's *own* epoch — two objects in a conjunction may have TLEs of quite different ages, and the fresher one legitimately contributes less uncertainty.

**The UI never overstates this.** The label is literally "Estimated Pc ⓘ", and the tooltip reads:

> Simplified 2D encounter-plane estimate (Pc ≈ HBR²/2σ² · e^(−d²/2σ²)), using typical published SGP4 error growth as σ since TLEs carry no real covariance data. Not a rigorous agency-grade probability.

### 8.4 A counterintuitive property — know this before Q&A

**Pc gets *smaller* as the data gets staler.**

This looks like a bug and is not. As σ grows, the probability mass spreads over a larger volume, lowering the density at any single point — including at the miss distance. Mathematically the `1/2σ²` prefactor and the widening exponential both push Pc down.

Real conjunction-assessment practice treats a very low Pc derived from high-uncertainty data with **caution, not comfort** — the correct reading is "we don't know enough," not "we are safe." Being able to state this unprompted demonstrates genuine understanding of the method rather than mechanical formula application.

---

## 9. Avoidance Simulator

On any conjunction's detail panel, a slider from **−1000 m to +1000 m** simulates displacing one object along its own velocity vector and live-recomputes miss distance, Pc, and risk tier.

```js
export function simulateNudge(satrecA, satrecB, tca, nudgeMeters) {
  const pvA = satellite.propagate(satrecA, tca);
  const pvB = satellite.propagate(satrecB, tca);
  const vMag = Math.sqrt(pvA.velocity.x**2 + pvA.velocity.y**2 + pvA.velocity.z**2);
  const nudgeKm = nudgeMeters / 1000;
  const nudged = {                               // unit velocity vector × displacement
    x: pvA.position.x + (pvA.velocity.x / vMag) * nudgeKm,
    y: pvA.position.y + (pvA.velocity.y / vMag) * nudgeKm,
    z: pvA.position.z + (pvA.velocity.z / vMag) * nudgeKm,
  };
  // ... recompute separation, Pc, tier
}
```

**What it is:** a geometric what-if. It takes the real ECI position and velocity at TCA, displaces one object along its normalised velocity direction, and recomputes separation.

**What it is not:** a burn simulation. A real avoidance manoeuvre applies a Δv, which changes the *entire orbit* — you would derive new elements and re-propagate. That is mission-planning software, out of scope for a browser dashboard.

**This is stated in the UI**, directly above the slider:

> Illustrative only — simulates nudging {object} along its own velocity direction, not a real burn/orbit propagation.

**Why include it anyway:** along-track displacement is genuinely the dominant term for small avoidance manoeuvres in the short run, so the intuition it builds — *how much margin does a small nudge actually buy?* — is real and useful, and the result feeds straight back through the same Pc estimator. The panel-safe framing: *"honest about being illustrative, useful because the dominant effect is the one being modelled."*

---

## 10. 3D Visualization Engine

### 10.1 Imagery with graceful degradation

The Viewer is constructed **synchronously** with Cesium's bundled offline texture, then upgraded to Esri satellite imagery once a reachability probe succeeds.

```js
const viewer = new Cesium.Viewer(container, { imageryProvider: offlineImageryProvider(), ... });
upgradeToSatelliteImagery(viewer, () => viewerRef.current === viewer)
  .then((source) => { if (source) setImagerySource(source); });
```

**Two non-obvious details, both found by testing:**

1. **Construction must be synchronous.** Deferring Viewer creation behind an `await` left the globe surface black — Cesium's tile pipeline expects to be wired up in the same tick the Viewer is created.
2. **The base layer is swapped, not stacked.** Adding Esri *on top* of a settled globe did not reliably trigger new tile requests. The working approach adds the new layers, then removes the old one.

The `isLive()` callback guards against the component unmounting mid-probe — a stale `.then()` must not touch a destroyed viewer.

A credit line always states which source is active, so the user is never misled about what they are looking at.

### 10.2 Entity model

| Entity | Scope | Update cadence |
|---|---|---|
| Object point | Every object | Position each ~400 ms tick |
| Orbit polyline | Every object | Rebuilt on data refresh (90 samples over one period) |
| Conjunction line | Each flagged pair | Endpoints each tick |
| Graticule | 12 meridians + 5 parallels + labels | Static; visibility toggled |
| Ground track | **Selected object only** | On selection (180 samples) |
| Comet trail | **Selected object only** | Rolling 30-point buffer each tick |

**Why ground track and trail are selection-scoped:** with up to 115 objects, rendering every ground track simultaneously would be unreadable. This is a deliberate legibility decision — detail on demand for the thing you are actually inspecting, rather than uniform clutter.

### 10.3 Colour semantics

```js
satellite: #3B82F6 (blue)   debris:   #94A3B8 (grey)
critical:  #EF4444 (red)    warning:  #F59E0B (amber)
```

Risk colour **overrides** type colour when an object is involved in a conjunction — the more urgent fact wins.

Trajectories are drawn with `PolylineOutlineMaterialProperty`: a coloured core with a dark outline. **Why not a glow?** A glow effect requires a dark background to read against; these lines cross bright deserts, cloud tops, and dark ocean within a single orbit. The outline keeps every colour legible across all of them.

The selected object's trajectory switches to a distinct white-with-blue-outline material — deliberately unlike *any* type or risk colour, so "this is the one I clicked" is never ambiguous with "this one is at risk."

### 10.4 Trajectory isolation

With isolation on (default), selecting an object hides every *other* trajectory — from a dense web of up to 115 orbit lines down to exactly one. All visibility concerns resolve in a **single effect**:

```js
useEffect(() => {
  satsRef.current.forEach((s) => {
    const typeVisible = s.type === 'debris' ? showDebris : showSatellites;
    if (e) e.show = typeVisible;
    if (o) o.show = typeVisible && showOrbits
                 && (!isolateTrajectory || !selected || s.id === selected.id);
  });
}, [showOrbits, showDebris, showSatellites, isolateTrajectory, selected, satellites]);
```

**Why one effect and not several:** type filters, the orbit master switch, and isolation all write to the same `.show` property. Split across separate effects, they would race — whichever ran last would win, producing order-dependent bugs. Combining them makes visibility a single pure function of all inputs.

`satellites` is in the dependency array so that a rebuilt entity set (after a data-source switch) picks up current toggle state instead of defaulting to Cesium's `show: true`.

### 10.5 A rendering bug worth citing

An earlier `renderEntities()` cleared only the *tracking maps*, not the Cesium entities themselves:

```js
entityMapRef.current.clear();   // map cleared — but entities still in the scene!
```

Switching data sources (115 live objects → 30 demo objects) left 115 orphaned points and orbits rendering, untracked and unremovable. The fix removes each entity from the scene before clearing the maps:

```js
entityMapRef.current.forEach((e) => viewer.entities.remove(e));
orbitMapRef.current.forEach((o) => viewer.entities.remove(o));
entityMapRef.current.clear();
orbitMapRef.current.clear();
```

**The general lesson, worth stating:** when a JS map is an *index into* a retained-mode scene graph rather than the owner of those objects, clearing the index leaks the objects.

---

## 11. User Interface Components

### 11.1 Home page

A landing screen over the dashboard. The Cesium globe is **already mounted and rendering underneath from the first frame** — "Enter Dashboard" is a pure CSS opacity transition, not a route change or a second Cesium initialisation. There is therefore no loading pause at the exact moment a live demo begins. The logo (pulsing dot, rotating dashed ring) is pure CSS, no image asset. Team credits sit bottom-right.

### 11.2 Sidebar

**Compact by default, expandable on demand.** Visible always: logo, live/demo switcher, status line, four stat boxes (Tracked / Risks / Critical / Closest), nine toggles, risk legend, search box.

The Conjunctions/Objects list is hidden until you type in search **or** pin it open with "Full List." The query string is the single source of truth for open/closed; Escape or an outside click clears it (skipped while pinned).

### 11.3 Info panel

For a selected object: altitude, velocity, lat/lon, an orbit-shape sketch, eccentricity, apogee/perigee, inclination, RAAN, argument of perigee, period, time since epoch, and B\* drag term.

**The orbit sketch is honestly labelled.** Real LEO eccentricities are ~0.0001–0.01 — visually indistinguishable from a circle. The sketch multiplies eccentricity by 10 (capped at 0.82) for legibility and captions itself *"illustrative — eccentricity exaggerated for clarity."* The same principle as the Pc label: exaggerate for communication, but say so.

"Sim time since epoch" turns amber past one day — a direct visual cue that propagation error is growing, tying back to §6.4 and §8.3.

### 11.4 Notification bell

Replaced permanently-stacked alert cards. A badge shows the count of **undismissed** critical conjunctions; the popover carries Track and Dismiss actions.

The pulse animation fires only when a **genuinely new** critical conjunction appears — tracked via a `seenRef` set of pair keys, not merely "is currently critical." Without that set, every 15-minute recompute would re-pulse for conjunctions the user already acknowledged.

### 11.5 Time scrubber

Spans **−6 h to +24 h relative to the epoch anchor** (§6.4), with speed presets 1× / 60× / 300× / 3600×. The range is deliberately aligned to the epoch rather than wall-clock, so that flagged conjunctions are always reachable on the slider.

### 11.6 Density ring

Concentric arcs showing object counts per altitude band (<500, 500–800, 800–1200, 1200–2000, >2000 km), each arc's fill proportional to that band's share of the maximum, colour-coded low/mid/high, with a labelled legend and a total in the centre.

### 11.7 About modal

Explains Kessler syndrome and the two historical events, with dates and fragment counts **verified by web search before being written into the UI** rather than recalled from memory — worth saying, because those specific numbers are the kind a panel may check.

---

## 12. Demo Mode

### 12.1 Purpose

A network-free path that guarantees a working demonstration regardless of CelesTrak availability, rate-limiting, or venue Wi-Fi.

### 12.2 The two scenarios

| Scenario | Composition | Verified conjunctions |
|---|---|---|
| **Mixed Orbital Field** | 10 satellites (3 shells) + 20 debris (3 real fields) | SIM-IRIDIUM-A/D **1.92 km** (critical) · SIM-COSMOS-A/B 6.84 km · SIM-FENGYUN-A/B 4.63 km |
| **ASAT Debris Field** | 5 satellites + 20 Fengyun-1C fragments | SIM2-FENGYUN-A/B **1.62 km** (critical) · A/L 6.94 km · B/L 5.32 km |

### 12.3 How the scenarios were built — and why they are defensible

They start from **real historical orbital elements** (actual Cosmos 2251, Iridium 33, Fengyun-1C, ISS, and Terra TLEs), cloned with small **fixed** offsets in RAAN and mean anomaly to spread objects realistically while guaranteeing some pairs pass close.

Two properties matter:

1. **Deterministic, not randomised.** Offsets are hard-coded, not `Math.random()`. The same objects and the same conjunctions appear every load — essential for a repeatable demo, at the cost of session variety.
2. **Verified, not assumed.** Every distance in the table above was produced by running the **actual `computeConjunctions` algorithm** against these TLEs in Node, then written into the source comments. They are measured outputs, not hopeful guesses.

If asked "is this fake data?" — the honest and strong answer is: *"The orbital elements are real; the specific arrangement is constructed and clearly labelled as a simulation, and every distance we quote was measured by the same algorithm that runs on live data."*

### 12.4 Guided demo

"▶ Play Demo" auto-focuses the most severe conjunction, holds ~6 seconds, then returns to overview. Deliberately two beats rather than a long scripted tour, so it does not depend on a chain of camera animations completing on schedule. All timers are tracked and cleared on unmount, so no `setState` fires against a torn-down component.

---

## 13. Data Export

A header button downloads the current conjunction list as CSV: object pair, miss distance, risk level, TCA (ISO 8601), relative velocity, estimated Pc (exponential notation).

Generated fully client-side via `Blob` + a temporary anchor element — no server, no dependency. Values are quoted with internal quotes doubled, per RFC 4180.

**Why CSV and not PDF:** CSV opens in Excel or Google Sheets, can be filtered and forwarded, and needs no new library. A PDF/print view was considered and dropped — it would have added a dependency for a strictly less useful artifact.

---

## 14. Performance Engineering

| Technique | Implementation | Effect |
|---|---|---|
| Object caps | Per-group caps totalling ≤ 115 | Bounds the quadratic pair term |
| Altitude pre-filter | Cheap band overlap before any propagation | Removes most pairs at negligible cost |
| Two-pass search | 90 s coarse → 1 s refine | Fine resolution only where it matters |
| Cooperative yielding | `await setTimeout(0)` every 25 pairs | UI stays responsive during computation |
| Render throttling | Position updates limited to ~400 ms | Decouples SGP4 cost from frame rate |
| Scrubber decoupling | Detection on refresh + 15 min timer only | Scrubbing never triggers recompute |
| Selective detail | Ground track/trail for selection only | Avoids 115 simultaneous ground tracks |
| Memoised derivations | `useMemo` for density, filtered lists | No recompute on unrelated renders |
| Stale-result guard | Monotonic token comparison | Superseded async results discarded |

**On the 400 ms render tick:** Cesium's `preRender` fires every frame (~60 fps). Propagating 115 objects 60 times a second is wasteful — LEO objects move predictably and a ~2.5 Hz positional update is visually smooth at typical zoom. The throttle cuts SGP4 work by roughly 24× with no perceptible quality loss.

---

## 15. Reliability and Failure Modes

| Failure | Detection | Response | User sees |
|---|---|---|---|
| CelesTrak unreachable | fetch throws / 8 s timeout | Serve cached TLEs | "⚠ Showing cached TLE data" |
| CelesTrak throttling | HTTP 403 + parseable body | Learn cadence, schedule next attempt | Cached data, silent |
| No cache, no network | Empty result | Zero objects for that group | "⚠ Live orbital data unavailable" |
| Esri unreachable | 3.5 s probe timeout | Bundled offline texture | Credit line names offline source |
| Malformed TLE | `twoline2satrec` throws | Skip that object, warn to console | One fewer object |
| Propagation failure | `pv.position` null | Skip that sample | Nothing |
| Component unmounts mid-fetch | `viewerRef.current !== viewer` | Abandon the update | Nothing |
| Overlapping computations | Token mismatch | Discard stale result | Nothing |
| `localStorage` unavailable | try/catch | Skip caching, live fetch still works | Nothing |

**The design principle:** every external dependency has a defined degraded state, and no single failure can produce a blank screen.

---

## 16. Known Limitations

State these proactively — volunteering them reads as rigour, and pre-empts the panel finding them.

1. **Estimated Pc, not rigorous Pc.** TLEs carry no covariance; σ comes from a published error-growth model, not measured tracking uncertainty (§8.3). Labelled as an estimate throughout the UI.
2. **Avoidance simulator is geometric.** Along-track displacement, not a Δv burn with re-derived elements (§9). Stated in the UI.
3. **CelesTrak throttles per IP, and signals it by timing out rather than refusing.** Fetching client-side spreads that budget across visitors, but a single user hard-refreshing repeatedly can still throttle themselves for a few minutes. The app falls back to cached TLEs and says so; Demo Mode is unaffected (§5.3).
4. **Object count is capped at ~115.** Deliberate, to keep the browser responsive. The catalogue holds tens of thousands — scaling to that requires the architecture in §18.
5. **Demo scenarios are fixed.** A reliability trade-off, not a missing feature (§12.3).
6. **Ground track and trail render for the selected object only.** A legibility choice, not a performance ceiling.
7. **No historical archive.** The app reasons about the present and near future; it does not store past conjunctions for trend analysis.
8. **Conjunction window is 49 hours.** Beyond that, TLE-based propagation error makes predictions unreliable — this bound is a physical honesty limit, not an arbitrary cut-off.

---

## 17. Anticipated Panel Questions

**Q: Is this real data or simulated?**
Both, by design. Live mode fetches real TLEs from CelesTrak. Demo mode uses real historical orbital elements arranged into a fixed, reproducible scenario, clearly labelled as such, so a demo never depends on network conditions. The same detection algorithm runs on both.

**Q: Why SGP4 rather than a simpler orbital model?**
Because the TLE format is *defined against* SGP4. TLE values are mean elements fitted so that propagating them with SGP4 reproduces observations. Using Keplerian two-body maths on TLE input would be formally incorrect, and would ignore J2 oblateness and atmospheric drag — both of which dominate LEO behaviour.

**Q: How accurate is your collision probability?**
It is an *estimate*, and the UI says so. The formula is the standard simplified 2D encounter-plane method. The limitation is σ: TLEs carry no covariance, so σ is modelled from published SGP4 error growth (~1 km at epoch, ~2 km/day) rather than measured tracking uncertainty. It is correct in form and honest about its input assumption — it is not agency-grade.

**Q: What happens if CelesTrak goes down during your demo?**
Three layers. Cached TLEs from `localStorage` serve first. If there is no cache, the dashboard still renders and says so. And Demo Mode needs no network at all — one click, fully functional.

**Q: Can this scale to the full catalogue of ~30,000 objects?**
Not in its current single-threaded browser form, and we would rather say that than overclaim. The path is concrete: move detection into Web Workers for parallelism, add spatial indexing beyond the current altitude pre-filter, and move heavy computation server-side with the browser as a pure view. The algorithm itself — pre-filter, coarse scan, refine — is exactly what scaled systems use; what changes is where it runs.

**Q: What is genuinely novel here versus an existing tracker?**
Three things. First, Pc estimation — most student projects stop at raw distance. Second, the self-learning cache that parses CelesTrak's own throttle response to schedule refreshes adaptively. Third, the zero-credential, zero-cost constraint held end to end, which is what makes it usable by the audience the problem statement names.

**Q: Why does the probability go *down* when the data is older?**
That is a real property of the method, not a bug. Larger σ spreads probability mass over a larger volume, lowering density everywhere including at the miss distance. Real practice reads a low Pc from stale data as "insufficient information," not as "safe."

**Q: What was the hardest bug?**
Epoch anchoring. Demo TLEs are epoched to Jan 2024; conjunction detection was anchored to wall-clock "now." Propagating two years past epoch produced a >14,000 km error on a ~7 km conjunction, and it failed *silently* — the pair was simply never flagged. The fix anchors demo data to its own TLE epoch while live data uses wall-clock, since live epochs track real time.

**Q: Why a browser instead of a desktop or server application?**
Zero installation is the point. The target user — a student team or a small operator — can open a URL. It also forced honest performance engineering: the constraints in §14 exist because there was nowhere to hide.

**Q: How do you know your conjunction detection is correct?**
Two ways. The demo scenarios' distances were verified by running the detection algorithm standalone in Node against known inputs and confirming the outputs match what is documented in source. And the epoch bug in §6.4 was caught precisely because a physically implausible result (14,000 km) was investigated rather than accepted.

**Q: What would you do with three more months?**
In priority order: Web Workers for parallel detection; a server-side ingestion service that caches TLEs centrally to lift the object cap; historical conjunction storage for trend analysis; and covariance ingestion from CDMs or operator-supplied ephemerides, which would upgrade Pc from estimated to rigorous.

---

## 18. Future Roadmap

**Near term**
- Move conjunction detection into **Web Workers** — pairs are independent, so this parallelises cleanly across cores.
- **Server-side ingestion service** that fetches TLEs once and serves many clients, removing the per-visitor request entirely.
- Raise the object cap behind the Worker change.

**Medium term**
- **Spatial indexing** (orbital-shell bucketing or a k-d tree over element space) to replace linear pre-filtering.
- **Historical archive** — persist conjunctions to enable trend analysis and "was this predicted?" review.
- **Configurable thresholds** — let an operator set their own screening volumes.

**Long term**
- **CDM ingestion** (Conjunction Data Messages) — the standard format that *does* carry covariance, upgrading Pc from estimated to rigorous.
- **Δv-based manoeuvre planning** — derive new elements from a velocity change and re-propagate, replacing the geometric simulator.
- **Multi-operator coordination** — shared awareness across constellation operators.

---

## 19. Appendix

### 19.1 Key constants

| Constant | Value | Location | Purpose |
|---|---|---|---|
| `RISK_THRESHOLDS.criticalKm` | 2 km | orbital.js | Critical tier |
| `RISK_THRESHOLDS.warningKm` | 10 km | orbital.js | Warning tier |
| `CANDIDATE_KM` | 50 km | orbital.js | Refine-pass trigger |
| `hoursBack` / `hoursAhead` | 1 / 48 | orbital.js | 49-hour detection window |
| `coarseStepSec` | 90 s | orbital.js | Coarse sampling |
| `refineWindowSec` / `refineStepSec` | 180 s / 1 s | orbital.js | Refinement |
| `yieldEveryPairs` | 25 | orbital.js | Cooperative yield interval |
| `MU_EARTH` | 398600.4418 km³/s² | orbital.js | Gravitational parameter |
| `SGP4_SIGMA_AT_EPOCH_KM` | 1 km | orbital.js | σ at epoch |
| `SGP4_SIGMA_GROWTH_KM_PER_DAY` | 2 km/day | orbital.js | σ growth |
| `DEFAULT_HBR_KM` | 0.02 km (20 m) | orbital.js | Hard-body radius |
| `FALLBACK_TTL_MS` | 2.25 h | orbital.js | Pre-learning cache TTL |
| `THROTTLE_SAFETY_BUFFER_MS` | 5 min | orbital.js | Buffer after learned cadence |
| `REFRESH_INTERVAL_MS` | 15 min | useCesium.js | Live refresh cadence |
| Render tick throttle | 400 ms | useCesium.js | Position update rate |
| Trail buffer | 30 points | useCesium.js | Comet trail length |
| Orbit path samples | 90 | orbital.js | Per full orbit |
| Ground track samples | 180 | orbital.js | Per full orbit |

### 19.2 File map

```
src/
├── lib/orbital.js            577 lines — all orbital mathematics, data
│                                          acquisition, caching, conjunction
│                                          detection, Pc, demo scenarios, CSV
├── hooks/useCesium.js        751 lines — Cesium lifecycle, entity management,
│                                          animation loop, selection/visibility
│                                          effects, guided demo
├── components/
│   ├── HomePage.jsx                    — landing screen + team credits
│   ├── Sidebar.jsx           267 lines — stats, toggles, search-reveal lists,
│   │                                      source/scenario switcher
│   ├── InfoPanel.jsx         102 lines — selected-object orbital elements
│   ├── ConjunctionDetail.jsx  91 lines — Pc display + avoidance simulator
│   ├── TimeScrubber.jsx       87 lines — time slider + speed controls
│   ├── NotificationBell.jsx   82 lines — critical alerts badge + popover
│   ├── DensityRing.jsx                 — altitude-band density chart
│   └── AboutModal.jsx                  — historical context
├── App.jsx                   106 lines — composition, CSV export trigger
├── main.jsx                            — React entry point
└── styles.css                587 lines — all styling
vite.config.js                          — build config (no proxy: fetch is client-side)
```

### 19.3 Running the project

```bash
npm install
npm run dev        # development, http://localhost:5173
```

For a demonstration:

```bash
npm run build
npm run preview    # serves the production build
```

> The build in `dist/` is **pure static files** — any static host works (Render static site, Netlify, GitHub Pages, `python3 -m http.server`). There is no server component and no proxy to configure: TLEs are fetched client-side straight from CelesTrak (§5.3).

### 19.4 Five-minute demo script

1. **Home page** — name the problem and the accessibility angle (§2.2).
2. **Enter Dashboard** — note the globe was already live underneath (§11.1).
3. **Live mode** — real CelesTrak TLEs, point at the Tracked/Risks/Critical stats.
4. **Switch to Demo → Mixed Orbital Field** — explain that elements are real, arrangement is fixed and verified (§12.3).
5. **Open the critical conjunction** — miss distance, TCA, relative velocity, and **estimated Pc**; say plainly why it is labelled "estimated" (§8.3).
6. **Drag the avoidance slider** — watch the tier flip to CLEARED; state that it is geometric, not a burn (§9).
7. **Toggle isolation / density ring / graticule** — show the visual layers.
8. **Export CSV** — a report an operator could forward.
9. **Close on the roadmap** — Web Workers, server-side ingestion, CDM covariance (§18).

---

*Prepared for panel presentation — Team CodeVisor, NIT Rourkela. All figures in this document were read directly from the project source rather than recalled; constants are cross-referenced to their definitions in §19.1.*
