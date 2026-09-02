# Napkin.ai Prompts — OrbitWatch (SIH 2026)

**How to use:** Napkin generates visuals *from the structure of your text*, not from a
description of a picture. So paste the **Style preamble** once to set the look, then paste
**one content block at a time** and pick the generated visual you like. Blocks are
ordered by how much they'll improve the deck.

**Two rules that matter most with Napkin:**
1. Keep each block short — 40–80 words. Long paragraphs produce cluttered visuals.
2. Make the relationship explicit in the words: `→` for flow, "vs" for comparison,
   numbered stages for process, "consists of" for hierarchy.

---

## Style preamble — paste once at the start of your Napkin doc

```
Visual style for all graphics in this document:

Domain: aerospace / space situational awareness. Professional, technical,
suitable for a national hackathon judging panel — not playful or cartoonish.

Colour palette:
- Deep navy #0B2E59 as the dominant colour
- Mission blue #125C9E and cyan #1C83A8 as supporting tones
- Amber #E88B0B for warnings, red #C9392E for critical risk, green #2C7D54 for safe/resolved
- White background, dark navy text

Style: flat vector, thin clean lines, generous whitespace, minimal icon set
(satellites, orbits, globe, signal, shield, database). No 3D bevels, no gradients,
no drop shadows, no stock photography. Labels in a clean sans-serif.
```

---

## Block 1 — Processing pipeline ⭐ highest value
*Use on: Technical Approach. Napkin should give you a horizontal 5-stage flow.*

```
OrbitWatch processes orbital data in five sequential stages:

1. Fetch — live Two-Line Element sets pulled from the CelesTrak GP API
2. Propagate — each object's orbit advanced through time using the SGP4 model
3. Detect — a two-pass search finds close approaches across a 49-hour window
4. Score — each approach rated by miss distance and estimated collision probability
5. Visualise — results rendered on a 3D globe with ranked risk alerts

The pipeline re-runs on every data refresh and on a 15-minute timer, independent
of the user's time-scrubber controls.
```

---

## Block 2 — Two-pass conjunction search ⭐ your strongest technical visual
*Use on: Technical Approach. This is the algorithm judges will probe — a diagram
of it is worth more than any other graphic in the deck.*

```
Checking every pair of tracked objects at full precision is computationally
impossible in a browser: 115 objects produce 6,555 pairs, and sampling each pair
every second across 49 hours would require roughly 2.3 billion orbit calculations.

OrbitWatch reduces this in three filtering stages:

Stage 1 — Altitude pre-filter: pairs whose perigee-to-apogee altitude bands cannot
overlap are discarded using simple arithmetic, with no orbit propagation at all.

Stage 2 — Coarse scan: surviving pairs are sampled every 90 seconds across the full
window to locate the approximate moment of closest approach.

Stage 3 — Refinement: only pairs that come within 50 kilometres are re-scanned at
1-second resolution in a 6-minute window, pinning down the exact miss distance and
time of closest approach.

Each stage passes far fewer pairs to the next, so the expensive computation runs
only where it can change the answer.
```

---

## Block 3 — The accessibility gap (problem → solution)
*Use on: Idea Title. Should produce a before/after or barrier-breaking comparison.*

```
Collision-risk screening today versus OrbitWatch:

Today, conjunction assessment exists only at agency scale. It depends on proprietary
tracking pipelines, paid data tiers and licensed software. Small satellite operators,
university CubeSat teams and classrooms are priced out entirely.

OrbitWatch delivers the same class of awareness — live object tracking, conjunction
detection and risk scoring — inside any web browser. It requires zero cost, zero
credentials and zero installation, running entirely on free public data.
```

---

## Block 4 — Three-layer architecture
*Use on: Technical Approach. Should produce a stacked-layer diagram.*

```
OrbitWatch is built in three layers:

The Data Layer acquires information: live orbital elements from the CelesTrak GP API,
Earth imagery from Esri, and a browser cache that learns the source's real refresh
schedule.

The Compute Layer performs the physics: SGP4 orbital propagation, altitude-band
pre-filtering, two-pass conjunction detection, collision-probability estimation, and
avoidance what-if simulation.

The Presentation Layer delivers the result: a React interface, a CesiumJS 3D globe,
risk alerts, a time scrubber, and CSV export.

All orbital mathematics lives in the Compute Layer as pure functions, independent of
the interface — so the physics can be tested on its own.
```

---

## Block 5 — Why distance alone isn't enough (the Pc concept)
*Use on: Idea Title or Technical Approach. This explains your differentiator.*

```
Miss distance alone does not describe collision risk.

Two objects passing one kilometre apart are safe if both positions are known to within
metres, but dangerous if positions are uncertain by kilometres. Real conjunction
assessment therefore reports a probability of collision, not a distance.

OrbitWatch estimates that probability from three inputs: the measured miss distance,
the combined physical size of the two objects, and a position-uncertainty model derived
from published SGP4 error growth — approximately 1 kilometre of error at the data's
epoch, growing by 2 kilometres per day.

Most student projects stop at raw distance. This is the metric operators actually act on.
```

---

## Block 6 — Layered resilience
*Use on: Feasibility and Viability. Should produce a fallback-chain or shield diagram.*

```
Every external dependency in OrbitWatch degrades instead of failing:

If the live data source is unreachable, the dashboard serves the last cached orbital
data and labels it as cached.

If the source rate-limits a request, the system reads the refresh schedule from the
rejection message and retries exactly when new data becomes available.

If Earth imagery cannot be reached, the globe falls back to a bundled offline texture.

If the network is unavailable entirely, demo mode runs a verified offline scenario
built from real historical debris data.

No single failure can produce a blank screen.
```

---

## Block 7 — Impact across four dimensions
*Use on: Impact and Benefits. Should produce a four-quadrant or four-card layout.*

```
OrbitWatch delivers impact across four dimensions:

Safety — earlier awareness of close approaches supports avoidance decisions, directly
relevant to operators flying through the Fengyun-1C and Cosmos–Iridium debris shells.

Economic — zero licensing cost against commercial conjunction-tracking platforms,
removing the largest barrier for small operators.

Educational — a real, inspectable orbital-mechanics pipeline rather than a black box,
readable in roughly 1,900 lines of source.

Access — the category of awareness used by large space agencies, brought within reach
of a laptop and a browser.
```

---

## Block 8 — The stakes, in numbers
*Use on: Impact and Benefits. Should produce a stat/number highlight graphic.*

```
The scale of the orbital debris problem:

3,531 fragments were catalogued from the 2007 Fengyun-1C anti-satellite test — the
largest debris-generating event in spaceflight history, with roughly 2,300 still
tracked today.

Approximately 2,370 fragments were created in a single instant by the 2009 collision
between Cosmos 2251 and Iridium 33, the first accidental collision between two intact
satellites.

Both debris fields still threaten active satellites, and both are modelled directly
inside OrbitWatch.
```

---

## Block 9 — Challenges and mitigations
*Use on: Feasibility and Viability. Should produce a paired comparison or table.*

```
Four engineering challenges and how each was solved:

Challenge: the data source rate-limits repeat requests.
Solution: a cache that reads the source's own throttle message and refetches exactly
when fresh data lands.

Challenge: orbital element sets carry no position-uncertainty data.
Solution: uncertainty modelled from published SGP4 error-growth studies, and labelled
"estimated" in the interface.

Challenge: browser security rules block direct access to the data source.
Solution: a server-side proxy that rewrites requests, sidestepping the restriction.

Challenge: over 100 tracked objects risk freezing the interface.
Solution: altitude pre-filtering plus an asynchronous search that yields control
every 25 pairs.
```

---

## Block 10 — Roadmap to scale
*Use on: Feasibility and Viability, or as a closing visual. Should produce a timeline.*

```
Scaling OrbitWatch from prototype to production:

Near term — move conjunction detection into Web Workers, running pair calculations in
parallel across CPU cores.

Medium term — add a server-side data service to remove the browser proxy limitation
and lift the object cap, plus spatial indexing to replace linear pre-filtering.

Long term — ingest Conjunction Data Messages, the standard format that does carry
position covariance, upgrading collision probability from estimated to rigorous.
```

---

## If a visual comes out wrong

| Problem | Fix |
|---|---|
| Too cluttered | Cut the block to 3–4 sentences and regenerate |
| Wrong visual type | Add a lead-in: "As a horizontal process flow:" / "As a comparison table:" / "As a layered stack:" |
| Generic icons | Add: "Use satellite, orbit, globe and radar iconography" |
| Colours off-brand | Re-paste the style preamble immediately above the block |
| Too much text in boxes | Shorten each item to under 8 words before regenerating |

---

## What to actually replace in the deck

The current deck already has hand-built graphics on every slide. Only swap one in if
Napkin's version is genuinely better. Priority order:

1. **Block 2 (two-pass search)** — this has no equivalent in the deck today and is the
   single most valuable visual you could add. It is the algorithm a technical panel
   will push on.
2. **Block 1 (pipeline)** — would upgrade the numbered list currently on slide 2.
3. **Block 5 (why distance isn't enough)** — makes your main differentiator visual
   rather than textual.

Keep the dashboard screenshot on the Technical Approach slide regardless. A real
working prototype outweighs any generated diagram.
