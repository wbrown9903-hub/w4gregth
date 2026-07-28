import * as THREE from 'three';
import worldData from './world.json';
import { buildWorld } from './world.js';
import { makeMaterial, makeSky, PALETTE } from './style.js';
import { makeCar, Vehicle, ChaseCamera } from './car.js';

const canvas = document.getElementById('view');
const bootEl = document.getElementById('boot');
const bootMsg = document.getElementById('bootmsg');
const speedEl = document.querySelector('#speed b');
const streetEl = document.getElementById('street');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
renderer.setSize(innerWidth, innerHeight, false);
renderer.setClearColor(PALETTE.fog);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.4, 3000);

scene.add(makeSky());

bootMsg.textContent = 'Building streets…';
const built = buildWorld(worldData);
const mat = makeMaterial();

for (const key of ['ground', 'roads', 'walls', 'roofs']) {
  const m = new THREE.Mesh(built.geometries[key], mat);
  m.frustumCulled = key !== 'ground';
  scene.add(m);
}

// ---- car ----
const carGroup = new THREE.Group();
const { parts } = makeCar();
// One merged mesh: the car is drawn every frame and does not need eight of them.
const carGeo = mergeGeometries(parts);
carGroup.add(new THREE.Mesh(carGeo, mat));
scene.add(carGroup);

function mergeGeometries(list) {
  const pos = [], nrm = [], tint = [], ao = [];
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal;
    const t = g.attributes.tint, a = g.attributes.ao;
    const idx = g.index ? g.index.array : null;
    const emit = (i) => {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      tint.push(t.getX(i), t.getY(i), t.getZ(i));
      ao.push(a.getX(i));
    };
    if (idx) for (let i = 0; i < idx.length; i++) emit(idx[i]);
    else for (let i = 0; i < p.count; i++) emit(i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('tint', new THREE.Float32BufferAttribute(tint, 3));
  g.setAttribute('ao', new THREE.Float32BufferAttribute(ao, 1));
  return g;
}

const vehicle = new Vehicle(carGroup);
const chase = new ChaseCamera(camera);

/** Spawn on the road outside the target house, facing along the street. */
function resetToTarget() {
  const t = built.target;
  vehicle.pos.set(t ? t.rect.cx + 9 : 0, 0, t ? t.rect.cz + 9 : 0);
  vehicle.vel.set(0, 0, 0);
  vehicle.speed = 0;
  vehicle.yaw = Math.PI * 0.25;
}
resetToTarget();

// ---- input ----
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.code === 'KeyC') chase.mode = (chase.mode + 1) % 3;
  if (e.code === 'KeyR') resetToTarget();
  keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const input = {
  get up() { return keys.has('KeyW') || keys.has('ArrowUp'); },
  get down() { return keys.has('KeyS') || keys.has('ArrowDown'); },
  get left() { return keys.has('KeyA') || keys.has('ArrowLeft'); },
  get right() { return keys.has('KeyD') || keys.has('ArrowRight'); },
  get brake() { return keys.has('Space'); },
};

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

/* Nearest named street, for the HUD. Roads are static, so this is a flat scan
   over segment midpoints — cheap enough at 478 roads and far simpler than a
   spatial index that would need rebuilding for nothing. */
const streetPts = [];
for (const r of worldData.roads) {
  if (!r.n) continue;
  for (let i = 0; i < r.p.length - 1; i++) {
    streetPts.push([(r.p[i][0] + r.p[i + 1][0]) / 2, (r.p[i][1] + r.p[i + 1][1]) / 2, r.n]);
  }
}
let curStreet = '';
let streetTimer = 0;

const clock = new THREE.Clock();
let frame = 0;

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);

  vehicle.update(dt, input);
  chase.update(dt, vehicle);
  mat.uniforms.uCam.value.copy(camera.position);

  speedEl.textContent = String(Math.round(vehicle.kmh));

  // Street readout, refreshed a few times a second rather than every frame.
  streetTimer -= dt;
  if (streetTimer <= 0) {
    streetTimer = 0.25;
    let best = null, bestD = 1600;
    for (const [x, z, name] of streetPts) {
      const d = (x - vehicle.pos.x) ** 2 + (z - vehicle.pos.z) ** 2;
      if (d < bestD) { bestD = d; best = name; }
    }
    if (best && best !== curStreet) {
      curStreet = best;
      streetEl.textContent = best;
      streetEl.classList.add('on');
    } else if (!best && curStreet) {
      curStreet = '';
      streetEl.classList.remove('on');
    }
  }

  renderer.render(scene, camera);

  if (++frame === 2) {
    bootEl.classList.add('gone');
    setTimeout(() => bootEl.remove(), 600);
    window.__READY__ = true;
  }
}

console.info('[world]', built.stats, built.target ? `target: ${built.target.label}` : 'no target');
window.__STATS__ = built.stats;
window.__CAR__ = vehicle;
tick();
