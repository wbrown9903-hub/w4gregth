#!/usr/bin/env node
/**
 * Screenshot the driving game from a few fixed vantage points.
 *
 * Drives the car directly through window.__CAR__ rather than synthesising key
 * presses, so shots are reproducible and do not depend on frame timing.
 *
 *   node neighborhood/tools/shot.mjs --out=neighborhood/shots
 */
import { chromium } from 'playwright';
import { GPU_ARGS } from '../../tools/gpuargs.mjs';
import { grab } from '../../tools/grab.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);
const PORT = Number(args.port ?? 5173);
const OUT = args.out ?? 'neighborhood/shots';
const W = Number(args.w ?? 1280);
const H = Number(args.h ?? 720);
const TIMEOUT = Number(args.timeout ?? 600000);

// x, z, yaw, camera mode. Chosen to cover the things a critic will judge:
// street-level silhouette, a curved residential run, and a wide roofline.
const SHOTS = [
  { name: 'street', x: 9, z: 9, yaw: 0.8, mode: 0 },
  { name: 'target-house', x: 4, z: 16, yaw: 2.4, mode: 0 },
  { name: 'curve', x: -120, z: 60, yaw: 1.9, mode: 0 },
  { name: 'wide', x: -40, z: -30, yaw: 0.6, mode: 2 },
  { name: 'hood', x: 60, z: 40, yaw: 3.1, mode: 1 },
];

const browser = await chromium.launch({ headless: true, args: GPU_ARGS });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

let failed = null;
try {
  await page.goto(`http://127.0.0.1:${PORT}/neighborhood/`, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUT,
  });
  await page.waitForFunction('window.__READY__ === true', null, { timeout: TIMEOUT });
  const stats = await page.evaluate('window.__STATS__');

  for (const s of SHOTS) {
    await page.evaluate((v) => {
      const c = window.__CAR__;
      // Snap to the road. Arbitrary coordinates land in back yards, and the
      // chase camera then trails into the house behind — which is how the
      // first capture run produced five frames of interior wall.
      const pose = window.__SNAP__ ? window.__SNAP__(v.x, v.z) : null;
      c.pos.set(pose ? pose.x : v.x, 0, pose ? pose.z : v.z);
      c.yaw = pose ? pose.yaw + (v.flip ? Math.PI : 0) : v.yaw;
      c.speed = 0;
      c.vel.set(0, 0, 0);
    }, s);
    // Let the chase camera settle onto the new pose before capturing.
    await page.evaluate(
      () => new Promise((r) => { let i = 0; const t = () => (++i > 40 ? r() : requestAnimationFrame(t)); requestAnimationFrame(t); })
    );
    await grab(page, `${OUT}/${s.name}.png`);
  }
  console.log(JSON.stringify({ ok: true, stats, shots: SHOTS.map((s) => s.name) }, null, 2));
} catch (e) {
  failed = e;
} finally {
  if (failed) {
    console.error(JSON.stringify({ ok: false, error: failed.message }, null, 2));
    console.error(logs.slice(-20).join('\n'));
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
}
