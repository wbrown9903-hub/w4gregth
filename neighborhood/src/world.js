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

/* ------------------------------------------------------------------ build */

export function buildWorld(world) {
  const walls = new Buf();
  const roofs = new Buf();
  const roads = new Buf();
  const group = new THREE.Group();
  let target = null;

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

    for (let i = 0; i < n; i++) {
      const p0 = pts[i], p1 = pts[(i + 1) % n];
      const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
      const l = Math.hypot(dx, dz);
      if (l < 0.05) continue;
      const nx = dz / l, nz = -dx / l;
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

    if (b.t && rect) target = { rect, h: b.h, pts: pts.slice(0, n), label: b.s || '9903 Magnolia River' };
  });

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
  const base = new THREE.Color('#93a05e');
  const dry = new THREE.Color('#b0a566');
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
    },
    target,
    stats: {
      buildings: world.buildings.length,
      roads: world.roads.length,
      tris: (walls.pos.length + roofs.pos.length + roads.pos.length) / 9 | 0,
    },
  };
}
