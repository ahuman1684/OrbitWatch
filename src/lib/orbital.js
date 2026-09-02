import * as satellite from 'satellite.js';
import * as Cesium from 'cesium';
// Last-resort fallback for live mode — see fetchGroup(). Regenerate with
// `node scripts/fetch-tle-snapshot.mjs`; empty until that has been run.
import TLE_SNAPSHOT from '../data/tleSnapshot.json';

// ─────────────────────────────────────────────────────────────────────────────
// Live orbital data — CelesTrak GP (TLE) API, no auth required.
// Each group is capped for performance: conjunction detection is O(pairs),
// and debris fields in particular cluster tightly in altitude, so raw object
// count (not just pair count) is the thing to keep in check.
//
// Fetched straight from celestrak.org: it serves `Access-Control-Allow-Origin: *`,
// so the browser can read it cross-origin with no proxy in between.
//
// This deliberately does NOT go through a server-side proxy. CelesTrak budgets
// requests per IP and enforces it by dropping packets — TCP connects, then the
// request hangs until it times out, rather than returning a 403. A proxy makes
// every visitor's request originate from the one host IP, so the whole user base
// shares a single budget and exhausts it almost immediately; that is what broke
// the Render deployment (ETIMEDOUT on every group). Fetching from the browser
// sends each request from that visitor's own IP, and lets the app deploy as pure
// static files with no server component at all.
// ─────────────────────────────────────────────────────────────────────────────
const CELESTRAK_BASE = 'https://celestrak.org/NORAD/elements/gp.php';

const CELESTRAK_GROUPS = [
  // Fengyun-1C has no named GROUP (unlike the other two breakup fields below)
  // — query by international designator instead, which returns the parent
  // object plus every cataloged fragment from the same launch/breakup.
  { key: 'fengyun',  type: 'debris',    cap: 15, url: `${CELESTRAK_BASE}?INTDES=1999-025&FORMAT=3LE` },
  { key: 'cosmos',   type: 'debris',    cap: 15, url: `${CELESTRAK_BASE}?GROUP=cosmos-2251-debris&FORMAT=3LE` },
  { key: 'iridium',  type: 'debris',    cap: 15, url: `${CELESTRAK_BASE}?GROUP=iridium-33-debris&FORMAT=3LE` },
  { key: 'starlink', type: 'satellite', cap: 40, url: `${CELESTRAK_BASE}?GROUP=starlink&FORMAT=3LE` },
  // Crewed stations (ISS, Tiangong, ...) and science satellites (Hubble, ...)
  // — so live "satellite" mode isn't just Starlink clones.
  { key: 'stations', type: 'satellite', cap: 15, url: `${CELESTRAK_BASE}?GROUP=stations&FORMAT=3LE` },
  { key: 'science',  type: 'satellite', cap: 15, url: `${CELESTRAK_BASE}?GROUP=science&FORMAT=3LE` },
];

// ─────────────────────────────────────────────────────────────────────────────
// Fixed demo scenarios — no live network needed. Each is spread around its
// orbits with fixed (not random-per-load) RAAN/mean-anomaly offsets so the
// layout is reproducible, with a few pairs deliberately near-duplicated to
// guarantee close approaches. Every distance below was verified against the
// real conjunction-detection algorithm before being baked in here — not
// hand-waved. Same TLE-epoch convention (1 Jan 2024) as the rest of the app.
// ─────────────────────────────────────────────────────────────────────────────
export const DEMO_SCENARIOS = {
  mixed: {
    label: 'Mixed Orbital Field',
    description: '10 satellites (3 shells) + 20 debris (3 real historical fields) — a general-purpose mix.',
    // Verified conjunctions: SIM-IRIDIUM-A/D 1.92 km (critical), SIM-COSMOS-A/B
    // 6.84 km and SIM-FENGYUN-A/B 4.63 km (both warning).
    tles: [
      ['SIM-STARLINK-A', '1 44713U 19074A   24001.50000000  .00001764  00000+0  13559-3 0  9991', '2 44713  53.0530  45.5210 0001420  80.2650 279.8530 15.06427812 21', 'satellite'],
      ['SIM-STARLINK-B', '1 44713U 19074A   24001.50000000  .00001764  00000+0  13559-3 0  9991', '2 44713  53.0530  90.5210 0001420  80.2650 339.8530 15.06427812 21', 'satellite'],
      ['SIM-STARLINK-C', '1 44713U 19074A   24001.50000000  .00001764  00000+0  13559-3 0  9991', '2 44713  53.0530 175.5210 0001420  80.2650 119.8530 15.06427812 21', 'satellite'],
      ['SIM-STARLINK-D', '1 44713U 19074A   24001.50000000  .00001764  00000+0  13559-3 0  9991', '2 44713  53.0530 255.5210 0001420  80.2650 219.8530 15.06427812 21', 'satellite'],
      ['SIM-STATION-A', '1 25544U 98067A   24001.50000000  .00016717  00000+0  10270-3 0  9993', '2 25544  51.6400 337.6640 0007776  35.4780 324.6830 15.50377579 10', 'satellite'],
      ['SIM-STATION-B', '1 25544U 98067A   24001.50000000  .00016717  00000+0  10270-3 0  9993', '2 25544  51.6400  67.6640 0007776  35.4780  84.6830 15.50377579 10', 'satellite'],
      ['SIM-STATION-C', '1 25544U 98067A   24001.50000000  .00016717  00000+0  10270-3 0  9993', '2 25544  51.6400 227.6640 0007776  35.4780 204.6830 15.50377579 10', 'satellite'],
      ['SIM-TERRA-A', '1 25994U 99068A   24001.50000000  .00000013  00000+0  13700-4 0  9995', '2 25994  98.2100 344.0400 0001400  93.4100 266.7200 14.57160013  5', 'satellite'],
      ['SIM-TERRA-B', '1 25994U 99068A   24001.50000000  .00000013  00000+0  13700-4 0  9995', '2 25994  98.2100  84.0400 0001400  93.4100 356.7200 14.57160013  5', 'satellite'],
      ['SIM-TERRA-C', '1 25994U 99068A   24001.50000000  .00000013  00000+0  13700-4 0  9995', '2 25994  98.2100 204.0400 0001400  93.4100 176.7200 14.57160013  5', 'satellite'],
      ['SIM-COSMOS-A', '1 34454U 93036RV  24001.50000000  .00000300  00000+0  47800-4 0  9991', '2 34454  74.0200 183.4500 0083200 278.9700  80.2400 14.50234501  3', 'debris'],
      ['SIM-COSMOS-B', '1 34454U 93036RV  24001.50000000  .00000300  00000+0  47800-4 0  9991', '2 34454  74.0200 183.4700 0083200 278.9700  80.2900 14.50234501  3', 'debris'],
      ['SIM-COSMOS-C', '1 34454U 93036RV  24001.50000000  .00000300  00000+0  47800-4 0  9991', '2 34454  74.0200 243.4500 0083200 278.9700 160.2400 14.50234501  3', 'debris'],
      ['SIM-COSMOS-D', '1 34454U 93036RV  24001.50000000  .00000300  00000+0  47800-4 0  9991', '2 34454  74.0200 313.4500 0083200 278.9700 240.2400 14.50234501  3', 'debris'],
      ['SIM-COSMOS-E', '1 34454U 93036RV  24001.50000000  .00000300  00000+0  47800-4 0  9991', '2 34454  74.0200  23.4500 0083200 278.9700 320.2400 14.50234501  3', 'debris'],
      ['SIM-COSMOS-F', '1 34454U 93036RV  24001.50000000  .00000300  00000+0  47800-4 0  9991', '2 34454  74.0200  93.4500 0083200 278.9700  20.2400 14.50234501  3', 'debris'],
      ['SIM-COSMOS-G', '1 34454U 93036RV  24001.50000000  .00000300  00000+0  47800-4 0  9991', '2 34454  74.0200 153.4500 0083200 278.9700 100.2400 14.50234501  3', 'debris'],
      ['SIM-IRIDIUM-A', '1 33766U 97051CA  24001.50000000  .00000420  00000+0  65200-4 0  9997', '2 33766  86.3900 260.1700 0013400 317.8900  42.1200 14.50199002  3', 'debris'],
      ['SIM-IRIDIUM-B', '1 33766U 97051CA  24001.50000000  .00000420  00000+0  65200-4 0  9997', '2 33766  86.3900 315.1700 0013400 317.8900 112.1200 14.50199002  3', 'debris'],
      ['SIM-IRIDIUM-C', '1 33766U 97051CA  24001.50000000  .00000420  00000+0  65200-4 0  9997', '2 33766  86.3900  10.1700 0013400 317.8900 192.1200 14.50199002  3', 'debris'],
      ['SIM-IRIDIUM-D', '1 33766U 97051CA  24001.50000000  .00000420  00000+0  65200-4 0  9997', '2 33766  86.3900 260.1780 0013400 317.8900  42.1350 14.50199002  3', 'debris'],
      ['SIM-IRIDIUM-E', '1 33766U 97051CA  24001.50000000  .00000420  00000+0  65200-4 0  9997', '2 33766  86.3900 120.1700 0013400 317.8900 292.1200 14.50199002  3', 'debris'],
      ['SIM-IRIDIUM-F', '1 33766U 97051CA  24001.50000000  .00000420  00000+0  65200-4 0  9997', '2 33766  86.3900 180.1700 0013400 317.8900  52.1200 14.50199002  3', 'debris'],
      ['SIM-IRIDIUM-G', '1 33766U 97051CA  24001.50000000  .00000420  00000+0  65200-4 0  9997', '2 33766  86.3900 230.1700 0013400 317.8900 132.1200 14.50199002  3', 'debris'],
      ['SIM-FENGYUN-A', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 196.1300 0060300 289.3400  70.3200 14.12521901  3', 'debris'],
      ['SIM-FENGYUN-B', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 196.1500 0060300 289.3400  70.3600 14.12521901  3', 'debris'],
      ['SIM-FENGYUN-C', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 326.1300 0060300 289.3400 230.3200 14.12521901  3', 'debris'],
      ['SIM-FENGYUN-D', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200  36.1300 0060300 289.3400 310.3200 14.12521901  3', 'debris'],
      ['SIM-FENGYUN-E', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 106.1300 0060300 289.3400  10.3200 14.12521901  3', 'debris'],
      ['SIM-FENGYUN-F', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 166.1300 0060300 289.3400  90.3200 14.12521901  3', 'debris'],
    ],
  },
  asat: {
    label: 'ASAT Debris Field',
    description: '5 satellites for context + 20 debris fragments from the real 2007 Fengyun-1C anti-satellite test field.',
    // Verified conjunctions: SIM2-FENGYUN-A/B 1.62 km (critical), SIM2-FENGYUN-A/L
    // 6.94 km and SIM2-FENGYUN-B/L 5.32 km (both warning).
    tles: [
      ['SIM2-STATION-A', '1 25544U 98067A   24001.50000000  .00016717  00000+0  10270-3 0  9993', '2 25544  51.6400 337.6640 0007776  35.4780 324.6830 15.50377579 10', 'satellite'],
      ['SIM2-STATION-B', '1 25544U 98067A   24001.50000000  .00016717  00000+0  10270-3 0  9993', '2 25544  51.6400  97.6640 0007776  35.4780 114.6830 15.50377579 10', 'satellite'],
      ['SIM2-STATION-C', '1 25544U 98067A   24001.50000000  .00016717  00000+0  10270-3 0  9993', '2 25544  51.6400 217.6640 0007776  35.4780 264.6830 15.50377579 10', 'satellite'],
      ['SIM2-TERRA-A', '1 25994U 99068A   24001.50000000  .00000013  00000+0  13700-4 0  9995', '2 25994  98.2100 344.0400 0001400  93.4100 266.7200 14.57160013  5', 'satellite'],
      ['SIM2-TERRA-B', '1 25994U 99068A   24001.50000000  .00000013  00000+0  13700-4 0  9995', '2 25994  98.2100 164.0400 0001400  93.4100 106.7200 14.57160013  5', 'satellite'],
      ['SIM2-FENGYUN-A', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 196.1300 0060300 289.3400  70.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-B', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 196.1370 0060300 289.3400  70.3340 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-C', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 216.1300 0060300 289.3400 100.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-D', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 236.1300 0060300 289.3400 130.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-E', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 256.1300 0060300 289.3400 160.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-F', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 276.1300 0060300 289.3400 190.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-G', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 296.1300 0060300 289.3400 220.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-H', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 316.1300 0060300 289.3400 250.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-I', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 336.1300 0060300 289.3400 280.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-J', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 356.1300 0060300 289.3400 310.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-K', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200  16.1300 0060300 289.3400 340.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-L', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 196.1600 0060300 289.3400  70.3800 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-M', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200  56.1300 0060300 289.3400  20.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-N', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200  76.1300 0060300 289.3400  40.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-O', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200  96.1300 0060300 289.3400  80.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-P', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 116.1300 0060300 289.3400 120.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-Q', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 136.1300 0060300 289.3400 140.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-R', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 156.1300 0060300 289.3400 180.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-S', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 176.1300 0060300 289.3400 260.3200 14.12521901  3', 'debris'],
      ['SIM2-FENGYUN-T', '1 29228U 99025AMK 24001.50000000  .00000150  00000+0  24800-4 0  9993', '2 29228  98.9200 186.1300 0060300 289.3400 340.3200 14.12521901  3', 'debris'],
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Caching + "fetch as soon as fresh data is actually available."
//
// CelesTrak rejects a repeat request for unchanged data with a 403 whose body
// literally states the exact last-successful-download timestamp and their
// real update cadence, e.g.: "GP data has not updated since your last
// successful download of GROUP=starlink at 2026-08-30 13:51:51 UTC. Data is
// updated once every 2 hours." Rather than guessing a fixed TTL, we parse
// that and schedule the next attempt right after their real refresh window
// closes — so a refresh is picked up as soon as it exists, without hammering
// them with requests that we already know will be rejected.
// ─────────────────────────────────────────────────────────────────────────────
const FALLBACK_TTL_MS = 2.25 * 60 * 60 * 1000; // used only before we've learned a real cadence
const THROTTLE_SAFETY_BUFFER_MS = 5 * 60 * 1000;
const CACHE_PREFIX = 'orbitwatch_tle_';
const ELIGIBLE_PREFIX = 'orbitwatch_next_';

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable/full — just skip caching, live fetch still works
  }
}

function parseThrottleMessage(text) {
  const m = text.match(/at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC\.?\s*Data is updated once every (\d+(?:\.\d+)?)\s*hours?/i);
  if (!m) return null;
  const lastUpdateMs = Date.parse(m[1] + 'Z');
  const cadenceHours = parseFloat(m[2]);
  if (Number.isNaN(lastUpdateMs) || Number.isNaN(cadenceHours)) return null;
  return { lastUpdateMs, cadenceHours };
}

function parse3LE(text) {
  const lines = text.trim().split('\n').map((l) => l.trimEnd());
  const out = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    if (lines[i + 1]?.startsWith('1 ') && lines[i + 2]?.startsWith('2 ')) {
      out.push([lines[i].trim(), lines[i + 1], lines[i + 2]]);
    }
  }
  return out;
}

async function fetchGroup({ key, url, cap }) {
  const cached = readJSON(CACHE_PREFIX + key);
  const nextEligible = readJSON(ELIGIBLE_PREFIX + key);
  const now = Date.now();

  // We've already learned (from a prior rejection) exactly when CelesTrak's
  // next real update lands — no point spending a round trip before then.
  if (cached && nextEligible && now < nextEligible) {
    return { key, tles: cached.tles, stale: false, ageMs: now - cached.timestamp };
  }
  // No learned schedule yet (first load) — fall back to a conservative TTL.
  if (cached && !nextEligible && now - cached.timestamp < FALLBACK_TTL_MS) {
    return { key, tles: cached.tles, stale: false, ageMs: now - cached.timestamp };
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    if (!res.ok) {
      const throttle = parseThrottleMessage(text);
      if (throttle) {
        const nextTime = throttle.lastUpdateMs + throttle.cadenceHours * 3600000 + THROTTLE_SAFETY_BUFFER_MS;
        writeJSON(ELIGIBLE_PREFIX + key, nextTime);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    let tles = parse3LE(text);
    if (!tles.length) throw new Error('empty response');
    if (cap) tles = tles.slice(0, cap);
    writeJSON(CACHE_PREFIX + key, { tles, timestamp: Date.now() });
    localStorage.removeItem(ELIGIBLE_PREFIX + key); // fresh success; relearn timing if throttled again later
    return { key, tles, stale: false, ageMs: 0 };
  } catch (e) {
    if (cached) {
      // Network/API failure — fall back to last good cache rather than
      // blanking the dashboard, but flag it so the UI can say so.
      return { key, tles: cached.tles, stale: true, ageMs: now - cached.timestamp };
    }
    // No cache either (first ever visit, or cleared storage). Rather than show
    // an empty globe, fall back to the TLE snapshot committed with the build.
    // It is real catalogue data, just fixed at its capture date — the UI says
    // so explicitly and shows that date, so it is never mistaken for live.
    const snap = TLE_SNAPSHOT.groups?.[key];
    if (snap?.length) {
      return {
        key,
        tles: cap ? snap.slice(0, cap) : snap,
        stale: true,
        ageMs: null,
        fromSnapshot: true,
      };
    }
    return { key, tles: [], stale: true, ageMs: null };
  }
}

// Runs `worker` over `items` at most `limit` at a time, preserving input order
// in the results.
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await worker(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

// CelesTrak budgets requests per IP and enforces it by dropping packets, so a
// burst reads as a timeout rather than a 403. Firing all six groups at once was
// itself enough of a burst to get tarpitted, so they go out at most two at a
// time. Cached groups short-circuit inside fetchGroup without touching the
// network, so this only paces real requests.
const FETCH_CONCURRENCY = 2;

// Fetches all tracked groups. Returns TLE triples tagged with their group's
// object type (debris fields and Starlink are unambiguous by source, more
// reliable than sniffing the name) plus overall staleness.
export async function fetchObjects() {
  const results = await mapWithConcurrency(CELESTRAK_GROUPS, FETCH_CONCURRENCY, fetchGroup);

  const tles = [];
  let stale = false;
  let hasData = false;
  let usedSnapshot = false;

  results.forEach((r, idx) => {
    const type = CELESTRAK_GROUPS[idx].type;
    if (r.tles.length) hasData = true;
    if (r.stale) stale = true;
    if (r.fromSnapshot) usedSnapshot = true;
    r.tles.forEach(([name, l1, l2]) => tles.push([name, l1, l2, type]));
  });

  return {
    tles,
    stale,
    hasData,
    usedSnapshot,
    snapshotCapturedAt: usedSnapshot ? TLE_SNAPSHOT.capturedAt : null,
    groups: results.map((r) => ({ key: r.key, stale: r.stale, ageMs: r.ageMs, count: r.tles.length })),
  };
}

const DEBRIS_KEYWORDS = ['DEB', 'R/B', 'DEBRIS', 'ROCKET', 'FRAG', 'OBJ'];

export function classifyType(name) {
  return DEBRIS_KEYWORDS.some((k) => name.toUpperCase().includes(k))
    ? 'debris'
    : 'satellite';
}

// Build satellite records from TLE tuples ([name, line1, line2, type?])
export function buildSatellites(tleArray) {
  const sats = [];
  tleArray.forEach(([name, line1, line2, forcedType], idx) => {
    try {
      const satrec = satellite.twoline2satrec(line1, line2);
      sats.push({
        id: idx,
        name: name.trim(),
        satrec,
        type: forcedType || classifyType(name),
        inclination: (satrec.inclo * 180) / Math.PI,
        periodMin: (2 * Math.PI) / satrec.no,
      });
    } catch (e) {
      console.warn('TLE parse failed:', name);
    }
  });
  return sats;
}

// Julian date (as used in TLEs / satrec.jdsatepoch) -> JS Date
export function julianToDate(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}

// The TLE epoch a satellite record is valid around — propagating far from
// this date makes SGP4 output meaningless (drag/perturbation error compounds).
// We anchor the simulation clock to this instead of wall-clock "now" so
// display stays physically correct even if the cache is a few hours stale.
export function meanEpochDate(sats) {
  if (!sats.length) return new Date();
  const avgJd = sats.reduce((sum, s) => sum + s.satrec.jdsatepoch, 0) / sats.length;
  return julianToDate(avgJd);
}

// Get geodetic + cartesian position at a given JS Date
export function getPosition(satrec, date) {
  const pv = satellite.propagate(satrec, date);
  if (!pv.position) return null;
  const gmst = satellite.gstime(date);
  const geo = satellite.eciToGeodetic(pv.position, gmst);
  const lat = satellite.degreesLat(geo.latitude);
  const lon = satellite.degreesLong(geo.longitude);
  const altKm = geo.height;
  if (isNaN(lat) || isNaN(lon) || isNaN(altKm)) return null;

  const speed = pv.velocity
    ? Math.sqrt(pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2)
    : 0;

  return {
    cartesian: Cesium.Cartesian3.fromDegrees(lon, lat, altKm * 1000),
    lat,
    lon,
    altKm,
    speedKms: speed,
  };
}

// Compute one full orbit path as an array of Cartesian3
export function computeOrbitPath(satrec, startDate, steps = 90) {
  const positions = [];
  const periodSec = ((2 * Math.PI) / satrec.no) * 60;
  const step = periodSec / steps;
  for (let i = 0; i <= steps; i++) {
    const t = new Date(startDate.getTime() + i * step * 1000);
    const p = getPosition(satrec, t);
    if (p) positions.push(p.cartesian);
  }
  return positions;
}

// Sub-satellite point path (2D projection onto Earth's surface) over one
// full orbit — surface-clamped, unlike computeOrbitPath's 3D ellipse. Used
// only for the currently-selected object, not rendered for everything at
// once (would be very cluttered with 30+ objects on screen).
export function computeGroundTrack(satrec, startDate, steps = 180) {
  const positions = [];
  const periodSec = ((2 * Math.PI) / satrec.no) * 60;
  const step = periodSec / steps;
  for (let i = 0; i <= steps; i++) {
    const t = new Date(startDate.getTime() + i * step * 1000);
    const p = getPosition(satrec, t);
    if (p) positions.push(Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
  }
  return positions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Conjunction detection
//
// Two-pass search per candidate pair:
//   1. Coarse scan across the whole window (60-120s steps) to find the
//      approximate time of closest approach.
//   2. If that coarse minimum is inside the candidate threshold, refine with
//      a fine-grained scan (~1s steps) in a window around it to pin down the
//      true TCA and miss distance.
// Pairs are pre-filtered by perigee/apogee altitude-band overlap so the
// expensive refine step only runs on pairs that could plausibly get close —
// full pairwise coverage at full precision is not tractable in-browser.
// ─────────────────────────────────────────────────────────────────────────────
export const RISK_THRESHOLDS = {
  criticalKm: 2,
  warningKm: 10,
};
const CANDIDATE_KM = 50; // coarse-pass trigger for running the refine pass

const MU_EARTH = 398600.4418; // km^3/s^2

// Cheap radial extent [perigee, apogee] in km from mean elements — used only
// to pre-filter pairs, not for the actual distance calculation.
function altitudeBand(satrec) {
  const n = satrec.no / 60; // rad/s
  const a = Math.cbrt(MU_EARTH / (n * n));
  return [a * (1 - satrec.ecco), a * (1 + satrec.ecco)];
}

function prefilterPairs(sats) {
  const bands = sats.map((s) => altitudeBand(s.satrec));
  const pairs = [];
  for (let i = 0; i < sats.length; i++) {
    for (let j = i + 1; j < sats.length; j++) {
      const [rp1, ra1] = bands[i];
      const [rp2, ra2] = bands[j];
      if (rp1 - CANDIDATE_KM <= ra2 + CANDIDATE_KM && rp2 - CANDIDATE_KM <= ra1 + CANDIDATE_KM) {
        pairs.push([i, j]);
      }
    }
  }
  return pairs;
}

// True 3D separation in the inertial (ECI) frame — this is the actual
// physical distance between the two objects at that instant, no need to
// round-trip through geodetic coordinates the way getPosition() does for
// globe rendering.
function eciDistanceKm(satrecA, satrecB, date) {
  const pvA = satellite.propagate(satrecA, date);
  const pvB = satellite.propagate(satrecB, date);
  if (!pvA.position || !pvB.position) return null;
  const dx = pvA.position.x - pvB.position.x;
  const dy = pvA.position.y - pvB.position.y;
  const dz = pvA.position.z - pvB.position.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function relativeVelocityKmS(satrecA, satrecB, date) {
  const pvA = satellite.propagate(satrecA, date);
  const pvB = satellite.propagate(satrecB, date);
  if (!pvA.velocity || !pvB.velocity) return null;
  const dx = pvA.velocity.x - pvB.velocity.x;
  const dy = pvA.velocity.y - pvB.velocity.y;
  const dz = pvA.velocity.z - pvB.velocity.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function classifyRisk(distKm) {
  if (distKm < RISK_THRESHOLDS.criticalKm) return 'critical';
  if (distKm < RISK_THRESHOLDS.warningKm) return 'warning';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Estimated collision probability (Pc) — standard simplified 2D encounter-
// plane formula, the "constant density over the hard-body sphere"
// approximation used when the hard-body radius is small relative to the
// combined position uncertainty (the same regime real Foster/Akella-Alfriend
// style methods use for small objects):
//
//   Pc ≈ (HBR² / 2σ²) · exp(-d² / 2σ²)
//
// TLEs carry no covariance data — that's a real, documented limitation of
// the format, not a shortcut we're taking — so σ can't come from actual
// tracking uncertainty the way it would at an agency like NASA CARA. Instead
// it's built from published SGP4 error-growth studies: ~1 km position error
// at epoch, growing ~2 km/day, combined in quadrature per object based on
// how far each one has actually propagated from its own epoch. This is
// explicitly an *estimate* — the UI labels it that way, never as a rigorous
// probability.
// ─────────────────────────────────────────────────────────────────────────────
const SGP4_SIGMA_AT_EPOCH_KM = 1;
const SGP4_SIGMA_GROWTH_KM_PER_DAY = 2;
export const DEFAULT_HBR_KM = 0.02; // 20 m combined hard-body radius (standard default when object size is unknown)

function sgp4PositionSigmaKm(satrec, atDate) {
  const epochDate = julianToDate(satrec.jdsatepoch);
  const days = Math.abs(atDate.getTime() - epochDate.getTime()) / 86400000;
  return SGP4_SIGMA_AT_EPOCH_KM + SGP4_SIGMA_GROWTH_KM_PER_DAY * days;
}

export function estimateCollisionProbability(satrecA, satrecB, atDate, distKm) {
  const sigmaA = sgp4PositionSigmaKm(satrecA, atDate);
  const sigmaB = sgp4PositionSigmaKm(satrecB, atDate);
  const sigma = Math.sqrt(sigmaA * sigmaA + sigmaB * sigmaB);
  if (sigma <= 0) return 0;
  const pc = ((DEFAULT_HBR_KM ** 2) / (2 * sigma * sigma)) * Math.exp(-(distKm * distKm) / (2 * sigma * sigma));
  return Math.min(pc, 1); // clamp — the small-HBR approximation can exceed 1 in degenerate near-zero-sigma cases
}

// Async + yields periodically so a few hundred candidate pairs don't block
// the main thread for seconds at a stretch — this runs on TLE refresh and on
// a wall-clock timer, never on every scrubber tick.
export async function computeConjunctions(sats, centerDate, {
  hoursBack = 1,
  hoursAhead = 48,
  coarseStepSec = 90,
  refineWindowSec = 180,
  refineStepSec = 1,
  yieldEveryPairs = 25,
} = {}) {
  if (sats.length < 2) return [];

  const windowStart = new Date(centerDate.getTime() - hoursBack * 3600000);
  const totalSec = (hoursBack + hoursAhead) * 3600;
  const candidatePairs = prefilterPairs(sats);

  const results = [];
  for (let idx = 0; idx < candidatePairs.length; idx++) {
    const [i, j] = candidatePairs[idx];
    const satrecA = sats[i].satrec;
    const satrecB = sats[j].satrec;

    let bestT = 0;
    let bestD = Infinity;
    for (let t = 0; t <= totalSec; t += coarseStepSec) {
      const d = eciDistanceKm(satrecA, satrecB, new Date(windowStart.getTime() + t * 1000));
      if (d !== null && d < bestD) {
        bestD = d;
        bestT = t;
      }
    }

    if (bestD < CANDIDATE_KM) {
      let refinedD = bestD;
      let refinedT = bestT;
      const lo = Math.max(0, bestT - refineWindowSec);
      const hi = Math.min(totalSec, bestT + refineWindowSec);
      for (let t = lo; t <= hi; t += refineStepSec) {
        const d = eciDistanceKm(satrecA, satrecB, new Date(windowStart.getTime() + t * 1000));
        if (d !== null && d < refinedD) {
          refinedD = d;
          refinedT = t;
        }
      }

      const riskLevel = classifyRisk(refinedD);
      if (riskLevel) {
        const tca = new Date(windowStart.getTime() + refinedT * 1000);
        results.push({
          i, j,
          name1: sats[i].name,
          name2: sats[j].name,
          distKm: refinedD,
          time: tca,
          riskLevel,
          relativeVelocityKmS: relativeVelocityKmS(satrecA, satrecB, tca),
          pcEstimate: estimateCollisionProbability(satrecA, satrecB, tca, refinedD),
        });
      }
    }

    if (idx % yieldEveryPairs === yieldEveryPairs - 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return results.sort((a, b) => a.distKm - b.distKm);
}

// Illustrative "what if we nudge object A along-track by this much" simulator
// — NOT a real burn/orbit propagation (that would require deriving a whole
// new TLE), just a straight-line displacement of A's position at TCA along
// its own velocity direction, for a quick what-if on the resulting miss
// distance and estimated Pc. Clearly labeled as illustrative in the UI.
export function simulateNudge(satrecA, satrecB, tca, nudgeMeters) {
  const pvA = satellite.propagate(satrecA, tca);
  const pvB = satellite.propagate(satrecB, tca);
  if (!pvA.position || !pvB.position || !pvA.velocity) return null;

  const vMag = Math.sqrt(pvA.velocity.x ** 2 + pvA.velocity.y ** 2 + pvA.velocity.z ** 2);
  if (vMag === 0) return null;
  const nudgeKm = nudgeMeters / 1000;
  const nudged = {
    x: pvA.position.x + (pvA.velocity.x / vMag) * nudgeKm,
    y: pvA.position.y + (pvA.velocity.y / vMag) * nudgeKm,
    z: pvA.position.z + (pvA.velocity.z / vMag) * nudgeKm,
  };
  const dx = nudged.x - pvB.position.x;
  const dy = nudged.y - pvB.position.y;
  const dz = nudged.z - pvB.position.z;
  const newDistKm = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return {
    newDistKm,
    newPc: estimateCollisionProbability(satrecA, satrecB, tca, newDistKm),
    newRisk: classifyRisk(newDistKm),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Altitude density buckets — for the heatmap ring.
// Returns [{ band, label, count }] grouped by altitude range.
// ─────────────────────────────────────────────────────────────────────────────
export function computeAltitudeDensity(sats, date) {
  const bands = [
    { min: 0,    max: 500,   label: '< 500 km' },
    { min: 500,  max: 800,   label: '500–800 km' },
    { min: 800,  max: 1200,  label: '800–1200 km' },
    { min: 1200, max: 2000,  label: '1200–2000 km' },
    { min: 2000, max: 99999, label: '> 2000 km' },
  ];
  const counts = bands.map((b) => ({ ...b, count: 0 }));
  sats.forEach((s) => {
    const p = getPosition(s.satrec, date);
    if (!p) return;
    const band = counts.find((b) => p.altKm >= b.min && p.altKm < b.max);
    if (band) band.count++;
  });
  return counts;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV export — a report an operator could actually forward, not just a
// screenshot of the dashboard.
// ─────────────────────────────────────────────────────────────────────────────
export function conjunctionsToCSV(conjunctions) {
  const header = ['Object A', 'Object B', 'Miss Distance (km)', 'Risk Level', 'TCA (UTC)', 'Relative Velocity (km/s)', 'Estimated Pc'];
  const rows = conjunctions.map((c) => [
    c.name1,
    c.name2,
    c.distKm.toFixed(3),
    c.riskLevel,
    c.time.toISOString(),
    c.relativeVelocityKmS != null ? c.relativeVelocityKmS.toFixed(3) : '',
    c.pcEstimate != null ? c.pcEstimate.toExponential(3) : '',
  ]);
  const escape = (v) => `"${String(v).replace(/"/g, '""')}"`;
  return [header, ...rows].map((row) => row.map(escape).join(',')).join('\n');
}
