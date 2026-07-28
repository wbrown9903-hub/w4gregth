import * as THREE from 'three';
import { HOUSE_COLORS, ROOF_COLORS } from './style.js';

/**
 * Builds the neighbourhood mesh from the OSM extract.
 *
 * Everything merges into four buffers — ground, roads, walls, roofs — because
 * 1,607 individual meshes would be 1,607 draw calls and the frame budget is
 * gone before anything is shaded. Per-building variation rides on vertex
 * attributes (`tint`, `ao`) instead of separate materials.
 */

/* ---------------------------------------------------------------- helpers */

/** Deterministic per-building noise, so a house looks the same every load. */
function hash(i) {
  let x = Math.sin(i * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

/** Minimum-area enclosing rectangle. Roofs must align to the house, not to
 *  world axes, or every hip roof in a curved cul-de-sac sits skewed. */
function minAreaRect(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len, uz = dz / len;
    let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
    for (const p of pts) {
      const u = p[0] * ux + p[1] * uz;
      const v = -p[0] * uz + p[1] * ux;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      best = { area, ux, uz, minU, maxU, minV, maxV };
    }
  }
  if (!best) return null;
  const { ux, uz, minU, maxU, minV, maxV } = best;
  const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
  return {
    cx: cu * ux - cv * uz,
    cz: cu * uz + cv * ux,
    ux, uz,
    hw: (maxU - minU) / 2, // half-length along the edge direction
    hd: (maxV - minV) / 2,
  };
}

class Buf {
  constructor() { this.pos = []; this.nrm = []; this.tint = []; this.ao = []; }
  tri(a, b, c, n, col, ao) {
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) {
      this.nrm.push(n[0], n[1], n[2]);
      this.tint.push(col.r, col.g, col.b);
    }
    this.ao.push(ao[0], ao[1], ao[2]);
  }
  quad(a, b, c, d, n, col, ao) {
    this.tri(a, b, c, n, col, [ao[0], ao[1], ao[2]]);
    this.tri(a, c, d, n, col, [ao[0], ao[2], ao[3]]);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('tint', new THREE.Float32BufferAttribute(this.tint, 3));
    g.setAttribute('ao', new THREE.Float32BufferAttribute(this.ao, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const norm = (ax, ay, az, bx, by, bz) => {
  const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
};

/* ------------------------------------------------------------------ roofs */

function hipRoof(buf, rect, baseY, rise, overhang, col) {
  const { cx, cz, ux, uz, hw, hd } = rect;
  const W = hw + overhang, D = hd + overhang;
  const px = -uz, pz = ux; // perpendicular
  const P = (u, v, y) => [cx + u * ux + v * px, y, cz + u * uz + v * pz];

  // Ridge runs along the long axis and is inset by the short half-width, which
  // is what makes a hip rather than a gable.
  const ridge = Math.max(0, W - D);
  const e0 = P(-W, -D, baseY), e1 = P(W, -D, baseY);
  const e2 = P(W, D, baseY), e3 = P(-W, D, baseY);
  const r0 = P(-ridge, 0, baseY + rise), r1 = P(ridge, 0, baseY + rise);

  const face = (a, b, c, d) => {
    const n = norm(b[0] - a[0], b[1] - a[1], b[2] - a[2], c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    // Winding here depends on the rectangle's arbitrary edge direction, so half
    // the slopes come out facing down and shade as though lit from underground
    // — which renders every roof in the neighbourhood black. A roof face always
    // points up, so this is unambiguous to correct.
    if (n[1] < 0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
    if (d) buf.quad(a, b, c, d, n, col, [0.82, 0.82, 1, 1]);
    else buf.tri(a, b, c, n, col, [0.82, 0.82, 1]);
  };
  face(e0, e1, r1, r0);   // long slope
  face(e2, e3, r0, r1);   // opposite slope
  face(e1, e2, r1);       // hip end
  face(e3, e0, r0);       // hip end
}

function flatRoof(buf, pts, y, col) {
  const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  let tris = [];
  try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch { return; }
  for (const [i, j, k] of tris) {
    const a = [contour[i].x, y, contour[i].y];
    const b = [contour[j].x, y, contour[j].y];
    const c = [contour[k].x, y, contour[k].y];
    buf.tri(a, b, c, [0, 1, 0], col, [1, 1, 1]);
  }
}

/* ------------------------------------------------------------------ trees */

const TRUNK = new THREE.Color('#6b4a32');
const CANOPY = ['#4e7a34', '#5d8a3a', '#436a2c', '#6b9440', '#537f38'].map((h) => new THREE.Color(h));

/**
 * Low-poly tree: a tapered trunk and two stacked cones.
 *
 * Cones rather than spheres because the silhouette is what survives at this
 * shading level, and a hard conical outline reads as "stylised tree" where a
 * smooth blob reads as "untextured sphere".
 */
function tree(buf, x, z, h, scale) {
  const canopy = CANOPY[(h * CANOPY.length) | 0];
  const th = 1.6 * scale;
  const tr = 0.19 * scale;

  // Trunk: a 5-sided prism. Six would not read any rounder at this size.
  const SIDES = 5;
  for (let i = 0; i < SIDES; i++) {
    const a0 = (i / SIDES) * Math.PI * 2;
    const a1 = ((i + 1) / SIDES) * Math.PI * 2;
    const p0 = [x + Math.cos(a0) * tr, 0, z + Math.sin(a0) * tr];
    const p1 = [x + Math.cos(a1) * tr, 0, z + Math.sin(a1) * tr];
    const p2 = [x + Math.cos(a1) * tr * 0.7, th, z + Math.sin(a1) * tr * 0.7];
    const p3 = [x + Math.cos(a0) * tr * 0.7, th, z + Math.sin(a0) * tr * 0.7];
    const nx = Math.cos((a0 + a1) / 2), nz = Math.sin((a0 + a1) / 2);
    buf.quad(p0, p1, p2, p3, [nx, 0, nz], TRUNK, [0.5, 0.5, 1, 1]);
  }

  const cone = (baseY, r, ch) => {
    const N = 7;
    const apex = [x, baseY + ch, z];
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 1) / N) * Math.PI * 2;
      const p0 = [x + Math.cos(a0) * r, baseY, z + Math.sin(a0) * r];
      const p1 = [x + Math.cos(a1) * r, baseY, z + Math.sin(a1) * r];
      const am = (a0 + a1) / 2;
      // Normal tilted outward and up, so the ramp shader lights the canopy as
      // a rounded mass rather than as flat facets.
      const n = norm(p1[0] - p0[0], 0, p1[2] - p0[2], apex[0] - p0[0], apex[1] - p0[1], apex[2] - p0[2]);
      if (n[1] < 0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
      buf.tri(p0, p1, apex, [n[0] * 0.7 + Math.cos(am) * 0.3, Math.abs(n[1]) * 0.6 + 0.4, n[2] * 0.7 + Math.sin(am) * 0.3], canopy, [0.72, 0.72, 1]);
    }
  };
  cone(th * 0.72, 1.5 * scale, 2.1 * scale);
  cone(th * 1.5, 1.05 * scale, 1.9 * scale);
}

/* ---------------------------------------------------------------- windows */

const GLASS = new THREE.Color('#3d5468');
const FRAME = new THREE.Color('#efe9df');

/** Windows and a front door, punched onto wall faces as proud quads. */
function openings(buf, p0, p1, nx, nz, height, seed) {
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
  const len = Math.hypot(dx, dz);
  if (len < 3.2 || height < 2.4) return;
  const ux = dx / len, uz = dz / len;
  const off = 0.06; // stand proud so it never z-fights the wall

  const count = Math.max(1, Math.min(3, Math.floor(len / 3.4)));
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const cx = p0[0] + ux * len * t;
    const cz = p0[1] + uz * len * t;
    const w = Math.min(1.25, len / count * 0.42);
    const isDoor = seed > 0.72 && i === (count >> 1);
    const y0 = isDoor ? 0.02 : 1.02;
    const y1 = isDoor ? 2.12 : 2.18;
    if (y1 > height - 0.25) continue;

    const a = [cx - ux * w + nx * off, y0, cz - uz * w + nz * off];
    const b = [cx + ux * w + nx * off, y0, cz + uz * w + nz * off];
    const c = [cx + ux * w + nx * off, y1, cz + uz * w + nz * off];
    const d = [cx - ux * w + nx * off, y1, cz - uz * w + nz * off];
    buf.quad(a, b, c, d, [nx, 0, nz], isDoor ? FRAME : GLASS, [0.7, 0.7, 1, 1]);
  }
}

/* ------------------------------------------------------------------ build */

export function buildWorld(world) {
  const walls = new Buf();
  const roofs = new Buf();
  const roads = new Buf();
  const group = new THREE.Group();
  let target = null;
  let treeCount = 0;

  // ---- roads ----
  const asphalt = new THREE.Color('#5a5550');
  const bigRoad = new THREE.Color('#635d57');
  for (const r of world.roads) {
    const col = r.k >= 3 ? bigRoad : asphalt;
    const hwd = r.w / 2;
    for (let i = 0; i < r.p.length - 1; i++) {
      const [x0, z0] = r.p[i];
      const [x1, z1] = r.p[i + 1];
      let dx = x1 - x0, dz = z1 - z0;
      const l = Math.hypot(dx, dz);
      if (l < 0.01) continue;
      dx /= l; dz /= l;
      // Extend each segment half a width so corners close without mitring.
      const ex = dx * hwd * 0.5, ez = dz * hwd * 0.5;
      const px = -dz * hwd, pz = dx * hwd;
      const y = 0.04 + r.k * 0.012; // bigger roads sit fractionally proud
      const a = [x0 - ex + px, y, z0 - ez + pz];
      const b = [x1 + ex + px, y, z1 + ez + pz];
      const c = [x1 + ex - px, y, z1 + ez - pz];
      const d = [x0 - ex - px, y, z0 - ez - pz];
      roads.quad(a, b, c, d, [0, 1, 0], col, [1, 1, 1, 1]);
    }
  }

  /* ---- lots ----
   * A lawn pad and a driveway per house. Without them every building sits on
   * undifferentiated scrub, which is the single clearest tell that a street was
   * generated rather than built — real suburbia is legible as a row of lots
   * long before you can make out any individual house.
   */
  const lots = new Buf();
  const LAWN = ['#7f9a4e', '#8ea856', '#93a35a', '#75904a', '#a0aa62'].map((h) => new THREE.Color(h));
  const CONCRETE = new THREE.Color('#9d9890');

  const roadPoseFor = (cx, cz) => {
    let best = null;
    for (const r of world.roads) {
      if (r.k < 1) continue;
      for (let i = 0; i < r.p.length - 1; i++) {
        const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
        const dx = x1 - x0, dz = z1 - z0;
        const l2 = dx * dx + dz * dz;
        if (l2 < 1e-6) continue;
        const t = Math.max(0, Math.min(1, ((cx - x0) * dx + (cz - z0) * dz) / l2));
        const px = x0 + dx * t, pz = z0 + dz * t;
        const d = (px - cx) ** 2 + (pz - cz) ** 2;
        if (!best || d < best.d) best = { d, x: px, z: pz, w: r.w };
      }
    }
    return best;
  };

  // ---- buildings ----
  world.buildings.forEach((b, idx) => {
    const h = hash(idx);
    const isHouse = b.c === 'house';
    const wallCol = isHouse
      ? HOUSE_COLORS[(h * HOUSE_COLORS.length) | 0]
      : new THREE.Color(b.c === 'garage' ? '#c2ab92' : '#cbb9a4');
    const roofCol = ROOF_COLORS[((h * 7.3) % 1 * ROOF_COLORS.length) | 0];

    // Footprint winding is not guaranteed; normals are derived per-quad from
    // the edge so it does not matter which way OSM wound the way.
    const pts = b.p;
    const n = pts.length - (pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? 1 : 0);

    // OSM does not guarantee winding direction, so an edge normal derived from
    // the edge alone points inward for roughly half of all buildings. Those
    // walls then shade as interior surfaces. The footprint centroid settles it:
    // an exterior wall normal always points away from the middle.
    let ccx = 0, ccz = 0;
    for (let i = 0; i < n; i++) { ccx += pts[i][0]; ccz += pts[i][1]; }
    ccx /= n; ccz /= n;

    for (let i = 0; i < n; i++) {
      const p0 = pts[i], p1 = pts[(i + 1) % n];
      const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
      const l = Math.hypot(dx, dz);
      if (l < 0.05) continue;
      let nx = dz / l, nz = -dx / l;
      const mx = (p0[0] + p1[0]) / 2 - ccx;
      const mz = (p0[1] + p1[1]) / 2 - ccz;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      if (isHouse || b.c === 'apartments') openings(walls, p0, p1, nx, nz, b.h, hash(idx * 5.1 + i));
      const a = [p0[0], 0, p0[1]];
      const bb = [p1[0], 0, p1[1]];
      const c = [p1[0], b.h, p1[1]];
      const d = [p0[0], b.h, p0[1]];
      // Baked contact darkening at the base — cheap, and it seats the building
      // on the ground far better than any real-time term at this cost.
      walls.quad(a, bb, c, d, [nx, 0, nz], wallCol, [0.45, 0.45, 1, 1]);
    }

    const rect = minAreaRect(pts.slice(0, n));

    /*
     * A hip roof spans the building's bounding RECTANGLE, so it is only correct
     * on a footprint that actually is one. Two guards, both learned the hard
     * way from the first build:
     *
     *  - Rectangularity. An L-shaped or sprawling outline gets a roof covering
     *    its bounding box, i.e. a slab hanging over open ground.
     *  - Absolute size. OSM in this area tags apartment complexes as
     *    `building=house`; the worst is 305 x 171 m over 29,000 m². Roofed as a
     *    single hip that is a 300 m slab across the neighbourhood, and the
     *    spawn point sits underneath it — which is exactly what turned the sky
     *    black and hid every road in the first capture.
     *
     * Anything failing either test gets a flat roof triangulated from the real
     * polygon, which is always geometrically honest even when it is duller.
     */
    const rectArea = rect ? rect.hw * rect.hd * 4 : Infinity;
    const rectangularity = rect ? b.a / rectArea : 0;
    const pitched =
      (isHouse || b.c === 'garage') && rect && b.a < 500 && rectangularity > 0.72;

    if (pitched) {
      const rise = Math.min(rect.hd * 0.85, b.h > 5 ? 3.2 : 2.2);
      hipRoof(roofs, rect, b.h, rise, 0.45, roofCol);
    } else {
      flatRoof(roofs, pts.slice(0, n), b.h + 0.05, roofCol);
      // Parapet only where the outline really is close to its bounding box —
      // otherwise the wall ring floats away from the building it belongs to.
      if (rect && rectangularity > 0.72) {
        // Parapet, so flat-roofed blocks are not bare slabs from the road.
        const { cx, cz, ux, uz, hw, hd } = rect;
        const px = -uz, pz = ux;
        const P = (u, v, y) => [cx + u * ux + v * px, y, cz + u * uz + v * pz];
        const top = b.h + 0.75;
        const corners = [P(-hw, -hd, 0), P(hw, -hd, 0), P(hw, hd, 0), P(-hw, hd, 0)];
        for (let i = 0; i < 4; i++) {
          const p0 = corners[i], p1 = corners[(i + 1) % 4];
          const dx = p1[0] - p0[0], dz = p1[2] - p0[2];
          const l = Math.hypot(dx, dz) || 1;
          roofs.quad(
            [p0[0], b.h, p0[2]], [p1[0], b.h, p1[2]], [p1[0], top, p1[2]], [p0[0], top, p0[2]],
            [dz / l, 0, -dx / l], roofCol, [0.8, 0.8, 1, 1]
          );
        }
      }
    }

    // Lawn pad + driveway. Only for houses, and only where the house is close
    // enough to a road that a driveway is a short straight run — otherwise the
    // strip cuts across neighbouring lots to reach the carriageway.
    if (isHouse && rect) {
      const lawnCol = LAWN[(hash(idx * 11.3) * LAWN.length) | 0];
      const { cx, cz, ux, uz, hw, hd } = rect;
      const px = -uz, pz = ux;
      const pad = 5.5;
      const P = (u, v) => [cx + u * ux + v * px, 0.02, cz + u * uz + v * pz];
      lots.quad(P(-hw - pad, -hd - pad), P(hw + pad, -hd - pad), P(hw + pad, hd + pad), P(-hw - pad, hd + pad),
        [0, 1, 0], lawnCol, [1, 1, 1, 1]);

      const road = roadPoseFor(cx, cz);
      if (road && road.d < 2500) {
        const dx = road.x - cx, dz = road.z - cz;
        const l = Math.hypot(dx, dz) || 1;
        const dxn = dx / l, dzn = dz / l;
        const hwid = 1.9;
        const ox = -dzn * hwid, oz = dxn * hwid;
        // Start at the facade, not the centre, so the strip does not read as
        // running out from under the house.
        const s = Math.min(hw, hd) * 0.9;
        const a = [cx + dxn * s + ox, 0.03, cz + dzn * s + oz];
        const bq = [road.x + ox, 0.03, road.z + oz];
        const c = [road.x - ox, 0.03, road.z - oz];
        const d = [cx + dxn * s - ox, 0.03, cz + dzn * s - oz];
        lots.quad(a, bq, c, d, [0, 1, 0], CONCRETE, [0.92, 1, 1, 0.92]);
      }
    }

    if (b.t && rect) target = { rect, h: b.h, pts: pts.slice(0, n), label: b.s || '9903 Magnolia River' };
  });

  /* ---- trees ----
   * Placed against a coarse occupancy grid rather than by offsetting from each
   * building, which would drop them through roads and into neighbouring
   * houses. 4 m cells: fine enough that a tree never straddles a carriageway,
   * coarse enough that the grid stays small.
   */
  const trees = new Buf();
  {
    const bd0 = world.bounds;
    const CELL = 4;
    const gx0 = bd0.minX - 40, gz0 = bd0.minZ - 40;
    const gw = Math.ceil((bd0.maxX - bd0.minX + 80) / CELL);
    const gh = Math.ceil((bd0.maxZ - bd0.minZ + 80) / CELL);
    const occ = new Uint8Array(gw * gh);        // 1 = road or building
    const near = new Uint8Array(gw * gh);       // 1 = close to a building
    const at = (x, z) => {
      const i = Math.floor((x - gx0) / CELL);
      const j = Math.floor((z - gz0) / CELL);
      return i < 0 || j < 0 || i >= gw || j >= gh ? -1 : j * gw + i;
    };

    for (const r of world.roads) {
      const pad = r.w / 2 + 2.5;
      for (let i = 0; i < r.p.length - 1; i++) {
        const [x0, z0] = r.p[i], [x1, z1] = r.p[i + 1];
        const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (CELL * 0.5)) + 1;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
          for (let ox = -pad; ox <= pad; ox += CELL)
            for (let oz = -pad; oz <= pad; oz += CELL) {
              const k = at(px + ox, pz + oz);
              if (k >= 0) occ[k] = 1;
            }
        }
      }
    }

    for (const b of world.buildings) {
      let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
      for (const [x, z] of b.p) {
        if (x < mnx) mnx = x; if (x > mxx) mxx = x;
        if (z < mnz) mnz = z; if (z > mxz) mxz = z;
      }
      for (let x = mnx - 2; x <= mxx + 2; x += CELL)
        for (let z = mnz - 2; z <= mxz + 2; z += CELL) {
          const k = at(x, z); if (k >= 0) occ[k] = 1;
        }
      for (let x = mnx - 16; x <= mxx + 16; x += CELL)
        for (let z = mnz - 16; z <= mxz + 16; z += CELL) {
          const k = at(x, z); if (k >= 0) near[k] = 1;
        }
    }

    // Jittered lattice, kept only on free cells adjacent to development — so
    // the canopy follows the streets instead of carpeting empty scrubland.
    let n = 0;
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        if (occ[k] || !near[k]) continue;
        const h = hash(k * 1.37);
        if (h > 0.30) continue;
        const jx = (hash(k * 2.11) - 0.5) * CELL * 0.8;
        const jz = (hash(k * 3.71) - 0.5) * CELL * 0.8;
        // Mature suburban shade trees run 6-10 m. The first pass topped out
        // around 4 m, which reads as shrubbery from the road.
        tree(trees, gx0 + i * CELL + CELL / 2 + jx, gz0 + j * CELL + CELL / 2 + jz,
             hash(k * 5.23), 1.5 + hash(k * 7.19) * 1.3);
        n++;
      }
    }
    treeCount = n;
  }

  // ---- ground ----
  const bd = world.bounds;
  const pad = 220;
  const gw = bd.maxX - bd.minX + pad * 2;
  const gd = bd.maxZ - bd.minZ + pad * 2;
  const groundGeo = new THREE.PlaneGeometry(gw, gd, 48, 48);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate((bd.minX + bd.maxX) / 2, 0, (bd.minZ + bd.maxZ) / 2);
  const gcount = groundGeo.attributes.position.count;
  const gt = new Float32Array(gcount * 3);
  const ga = new Float32Array(gcount);
  /* Two tones close together on purpose. The first pass ran olive to tan across
     a 48x48 lattice on a FLAT plane, and vertex interpolation turned that into
     metre-scale soft blobs that read unmistakably as rolling desert hills — the
     eye interprets large smooth luminance gradients as relief even where the
     geometry is dead level. Narrowing the range keeps the scrub variation
     without inventing terrain that is not there. */
  const base = new THREE.Color('#8d9558');
  const dry = new THREE.Color('#97985c');
  for (let i = 0; i < gcount; i++) {
    const c = base.clone().lerp(dry, hash(i * 3.7));
    gt[i * 3] = c.r; gt[i * 3 + 1] = c.g; gt[i * 3 + 2] = c.b;
    ga[i] = 1;
  }
  groundGeo.setAttribute('tint', new THREE.BufferAttribute(gt, 3));
  groundGeo.setAttribute('ao', new THREE.BufferAttribute(ga, 1));

  return {
    group,
    geometries: {
      ground: groundGeo,
      roads: roads.geometry(),
      walls: walls.geometry(),
      roofs: roofs.geometry(),
      trees: trees.geometry(),
      lots: lots.geometry(),
    },
    target,
    stats: {
      buildings: world.buildings.length,
      roads: world.roads.length,
      trees: treeCount,
      tris: (walls.pos.length + roofs.pos.length + roads.pos.length + trees.pos.length + lots.pos.length) / 9 | 0,
    },
  };
}
