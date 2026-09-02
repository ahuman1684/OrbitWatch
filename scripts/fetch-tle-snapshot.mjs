#!/usr/bin/env node
/**
 * Refreshes the bundled TLE snapshot in src/data/tleSnapshot.json.
 *
 * The app fetches live TLEs from CelesTrak in the browser. When that is
 * unavailable — no network, or CelesTrak has temporarily blocked the visitor's
 * IP — it falls back to this snapshot so the globe still shows the real
 * catalogue instead of nothing. The UI labels it as a snapshot and shows its
 * capture date, so it is never passed off as live.
 *
 * Run it from a network CelesTrak is not currently blocking:
 *
 *     node scripts/fetch-tle-snapshot.mjs
 *
 * Worth re-running shortly before a demo: TLE accuracy decays with age, so a
 * fresh snapshot is a better fallback than a stale one.
 *
 * NOTE: CelesTrak rate-limits per IP and enforces it by dropping packets, so a
 * burst of requests can get the whole IP blocked for a while. This script goes
 * one group at a time with a pause between, deliberately.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://celestrak.org/NORAD/elements/gp.php';

// Must stay in sync with CELESTRAK_GROUPS in src/lib/orbital.js.
const GROUPS = [
  { key: 'fengyun',  cap: 15, query: 'INTDES=1999-025' },
  { key: 'cosmos',   cap: 15, query: 'GROUP=cosmos-2251-debris' },
  { key: 'iridium',  cap: 15, query: 'GROUP=iridium-33-debris' },
  { key: 'starlink', cap: 40, query: 'GROUP=starlink' },
  { key: 'stations', cap: 15, query: 'GROUP=stations' },
  { key: 'science',  cap: 15, query: 'GROUP=science' },
];

const PAUSE_MS = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parse3LE(text, cap) {
  const lines = text.trim().split('\n').map((l) => l.trimEnd());
  const out = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    if (lines[i + 1]?.startsWith('1 ') && lines[i + 2]?.startsWith('2 ')) {
      out.push([lines[i].trim(), lines[i + 1], lines[i + 2]]);
    }
    if (out.length >= cap) break;
  }
  return out;
}

const outPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/tleSnapshot.json');
const groups = {};
let failed = 0;

for (const [i, g] of GROUPS.entries()) {
  const url = `${BASE}?${g.query}&FORMAT=3LE`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tles = parse3LE(await res.text(), g.cap);
    if (!tles.length) throw new Error('no TLEs parsed');
    groups[g.key] = tles;
    console.log(`✓ ${g.key.padEnd(9)} ${String(tles.length).padStart(3)} objects`);
  } catch (err) {
    failed++;
    console.error(`✗ ${g.key.padEnd(9)} ${err.message}`);
  }
  if (i < GROUPS.length - 1) await sleep(PAUSE_MS);
}

if (!Object.keys(groups).length) {
  console.error('\nNo groups fetched — snapshot left unchanged.');
  console.error('If every group timed out, this IP is likely blocked by CelesTrak. Try another network.');
  process.exit(1);
}

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({
  capturedAt: new Date().toISOString(),
  note: 'Fallback only. Regenerate with: node scripts/fetch-tle-snapshot.mjs',
  groups,
}, null, 2) + '\n');

const total = Object.values(groups).reduce((n, g) => n + g.length, 0);
console.log(`\nWrote ${total} objects across ${Object.keys(groups).length} groups to src/data/tleSnapshot.json`);
if (failed) console.log(`${failed} group(s) failed — snapshot is partial.`);
