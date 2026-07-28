import * as THREE from 'three';

/**
 * Arcade vehicle.
 *
 * Not a simulation — no tyre slip curves, no weight transfer. The target is
 * "pleasant to drive around a suburb for ten minutes", which wants forgiving
 * grip, a tight turning circle at low speed and stability at high speed. Two
 * details do most of that work: steering authority falls off with speed (so it
 * is not twitchy on the arterials) and lateral velocity is bled off every frame
 * (so it corners instead of ice-skating).
 */

const MAX_SPEED = 27;      // ~60 mph
const REVERSE_SPEED = 9;
const ACCEL = 15;
const BRAKE = 26;
const DRAG = 0.62;
const GRIP = 7.5;

export function makeCar() {
  const g = new THREE.Group();

  const paint = new THREE.Color('#c94f3d');
  const glass = new THREE.Color('#2f3f4d');
  const trim = new THREE.Color('#22242a');

  const part = (w, h, d, col, x, y, z) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const n = geo.attributes.position.count;
    const t = new Float32Array(n * 3);
    const a = new Float32Array(n).fill(1);
    for (let i = 0; i < n; i++) { t[i * 3] = col.r; t[i * 3 + 1] = col.g; t[i * 3 + 2] = col.b; }
    geo.setAttribute('tint', new THREE.BufferAttribute(t, 3));
    geo.setAttribute('ao', new THREE.BufferAttribute(a, 1));
    geo.translate(x, y, z);
    return geo;
  };

  // Chunky proportions on purpose: a correctly-proportioned sedan reads as a
  // toy at this shading level, whereas a slightly stubby one reads stylised.
  const parts = [
    part(2.0, 0.62, 4.5, paint, 0, 0.72, 0),
    part(1.72, 0.56, 2.25, glass, 0, 1.26, -0.15),
    part(2.06, 0.2, 4.56, trim, 0, 0.44, 0),
  ];
  const wheels = [];
  for (const [x, z] of [[-0.92, 1.42], [0.92, 1.42], [-0.92, -1.42], [0.92, -1.42]]) {
    const w = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
    w.rotateZ(Math.PI / 2);
    const n = w.attributes.position.count;
    const t = new Float32Array(n * 3);
    const a = new Float32Array(n).fill(0.85);
    for (let i = 0; i < n; i++) { t[i * 3] = 0.09; t[i * 3 + 1] = 0.09; t[i * 3 + 2] = 0.1; }
    w.setAttribute('tint', new THREE.BufferAttribute(t, 3));
    w.setAttribute('ao', new THREE.BufferAttribute(a, 1));
    w.translate(x, 0.42, z);
    wheels.push(w);
  }

  return { parts: [...parts, ...wheels], group: g };
}

export class Vehicle {
  constructor(object3d) {
    this.obj = object3d;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  update(dt, input) {
    const throttle = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    const steerIn = (input.left ? 1 : 0) - (input.right ? 1 : 0);

    // Longitudinal
    if (throttle > 0) this.speed += ACCEL * dt;
    else if (throttle < 0) this.speed -= (this.speed > 0 ? BRAKE : ACCEL) * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), DRAG * 6 * dt);
    if (input.brake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), BRAKE * dt);
    this.speed = THREE.MathUtils.clamp(this.speed, -REVERSE_SPEED, MAX_SPEED);

    // Steering authority drops with speed, and vanishes at a standstill so the
    // car cannot pirouette on the spot.
    const sp = Math.abs(this.speed);
    const authority = Math.min(sp / 5, 1) * (1 - 0.55 * Math.min(sp / MAX_SPEED, 1));
    this.yaw += steerIn * authority * 2.1 * dt * Math.sign(this.speed || 1);

    this._fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this._right.set(this._fwd.z, 0, -this._fwd.x);

    // Bleed lateral velocity — this is the whole cornering feel.
    const lat = this.vel.dot(this._right);
    this.vel.addScaledVector(this._right, -lat * Math.min(1, GRIP * dt));
    const along = this.vel.dot(this._fwd);
    this.vel.addScaledVector(this._fwd, this.speed - along);

    this.pos.addScaledVector(this.vel, dt);
    this.obj.position.copy(this.pos);
    this.obj.rotation.y = this.yaw;
  }

  /** km/h for the HUD. */
  get kmh() { return Math.abs(this.speed) * 3.6; }
}

/**
 * Chase camera. Lags on position but not on aim, which keeps the horizon stable
 * while still giving a sense of the car swinging out of a turn.
 */
export class ChaseCamera {
  constructor(camera) {
    this.cam = camera;
    this.p = new THREE.Vector3(0, 5, -10);
    this.look = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this.mode = 0; // 0 chase, 1 hood, 2 high
  }

  update(dt, v) {
    const specs = [
      { back: 8.4, up: 3.5, ahead: 6, lag: 4.2 },
      { back: -0.4, up: 1.45, ahead: 12, lag: 22 },
      { back: 13, up: 9, ahead: 4, lag: 3.2 },
    ][this.mode];

    const fwd = new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw));
    this._d.copy(v.pos).addScaledVector(fwd, -specs.back);
    this._d.y += specs.up;

    const k = 1 - Math.exp(-specs.lag * dt);
    this.p.lerp(this._d, k);
    this.cam.position.copy(this.p);

    this.look.copy(v.pos).addScaledVector(fwd, specs.ahead);
    this.look.y += 1.1;
    this.cam.lookAt(this.look);
  }
}
