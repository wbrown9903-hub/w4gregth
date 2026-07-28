#!/usr/bin/env node
/**
 * OSM extract -> compact game world.
 *
 * Everything here comes from OpenStreetMap (ODbL). Road centrelines, building
 * footprints and street names are real; heights are inferred, because OSM
 * almost never carries them for single-family housing.
 *
 *   node neighborhood/tools/build-data.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = resolve(ROOT, 'data/magnolia.json');
const OUT = resolve(ROOT, 'src/world.json');

// Origin: 9903 Magnolia River. The world is metres east/north of this point.
const LAT0 = 29.4451040;
const LON0 = -98.6871199;
const TARGET_WAY = 1121805645;

const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);

const project = (lat, lon) => [(lon - LON0) * M_PER_DEG_LON, (lat - LAT0) * M_PER_DEG_LAT];

/** Lane width and draw priority per OSM highway class. */
const ROAD = {
  motorway: { w: 14, k: 5 }, motorway_link: { w: 8, k: 5 },
  trunk: { w: 12, k: 4 }, trunk_link: { w: 7, k: 4 },
  primary: { w: 11, k: 4 }, secondary: { w: 10, k: 3 },
  tertiary: { w: 8.5, k: 3 }, residential: { w: 7, k: 2 },
  unclassified: { w: 6, k: 2 }, service: { w: 4.5, k: 1 },
  living_street: { w: 6, k: 2 },
};

const raw = JSON.parse(readFileSync(SRC, 'utf8'));
const nodes = new Map();
for (const e of raw.elements) if (e.type === 'node') nodes.set(e.id, e);

const ptsOf = (way) => {
  const out = [];
  for (const id of way.nodes || []) {
    const n = nodes.get(id);
    if (n) out.push(project(n.lat, n.lon));
  }
  return out;
};

const area = (p) => {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++)
    a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return Math.abs(a) / 2;
};

const roads = [];
const buildings = [];

for (const e of raw.elements) {
  if (e.type !== 'way') continue;
  const t = e.tags || {};

  if (t.highway) {
    const spec = ROAD[t.highway];
    if (!spec) continue; // footways, cycleways and paths are not drivable
    const pts = ptsOf(e);
    if (pts.length < 2) continue;
    roads.push({
      p: pts.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]),
      w: spec.w,
      k: spec.k,
      n: t.name || '',
    });
    continue;
  }

  if (t.building) {
    const pts = ptsOf(e);
    if (pts.length < 4) continue;
    const a = area(pts);
    if (a < 12) continue; // sheds and map noise

    // Height: use OSM when present, else infer from class and footprint. Texas
    // suburban single-storey averages ~3.2 m to the eave; two-storey ~6.
    const lv = parseFloat(t['building:levels']);
    let h = parseFloat(t.height);
    if (!Number.isFinite(h)) {
      h = Number.isFinite(lv)
        ? lv * 3.1 + 0.4
        : t.building === 'garage' ? 2.8
        : t.building === 'apartments' ? 9.5
        : t.building === 'retail' || t.building === 'commercial' ? 6.5
        : a > 260 ? 6.0 : 3.4;
    }

    // OSM here tags large apartment complexes as `building=house` — the worst
    // is 29,000 m². Trusting the tag gives them single-family roofs and
    // single-storey heights. Footprint area is the more reliable signal.
    let cls = t.building === 'garage' ? 'garage'
      : t.building === 'apartments' ? 'apartments'
      : t.building === 'retail' || t.building === 'commercial' ? 'retail'
      : 'house';
    if (cls === 'house' && a > 500) {
      cls = 'apartments';
      if (!Number.isFinite(parseFloat(t.height)) && !Number.isFinite(lv)) h = 8.5;
    }

    buildings.push({
      p: pts.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2)]),
      h: +h.toFixed(2),
      c: cls,
      a: +a.toFixed(1),
      t: e.id === TARGET_WAY ? 1 : 0, // the enterable target house
      s: t['addr:housenumber'] ? `${t['addr:housenumber']} ${t['addr:street'] || ''}`.trim() : '',
    });
  }
}

// World bounds, for terrain sizing and the minimap.
// Roads run well past the built-up area — the ground plane is sized from BOTH
// or the terrain visibly ends partway along the arterials.
let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
const seen = (x, z) => {
  if (x < minX) minX = x; if (x > maxX) maxX = x;
  if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
};
for (const b of buildings) for (const [x, z] of b.p) seen(x, z);
for (const r of roads) for (const [x, z] of r.p) seen(x, z);

const world = {
  origin: { lat: LAT0, lon: LON0 },
  bounds: { minX: +minX.toFixed(1), maxX: +maxX.toFixed(1), minZ: +minZ.toFixed(1), maxZ: +maxZ.toFixed(1) },
  attribution: 'Map data © OpenStreetMap contributors, ODbL 1.0',
  roads,
  buildings,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(world));

const named = new Set(roads.filter((r) => r.n).map((r) => r.n));
console.log(JSON.stringify({
  roads: roads.length,
  buildings: buildings.length,
  target: buildings.filter((b) => b.t).length,
  streets: named.size,
  extent: `${(maxX - minX) | 0} x ${(maxZ - minZ) | 0} m`,
  bytes: JSON.stringify(world).length,
}, null, 2));
