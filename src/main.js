import { Engine } from './core/engine.js';
import { createConfig } from './core/config.js';

import { RenderSystem } from './render/index.js';
import { MaterialSystem } from './materials/index.js';
import { SkySystem } from './sky/index.js';
import { WorldSystem } from './world/index.js';
import { PhysicsSystem } from './physics/index.js';
import { PlayerSystem } from './player/index.js';
import { WeaponSystem } from './weapons/index.js';
import { FxSystem } from './fx/index.js';
import { AiSystem } from './ai/index.js';
import { UiSystem } from './ui/index.js';
import { AudioSystem } from './audio/index.js';

import { installShotApi } from './dev/shots.js';
import { prewarm } from './core/prewarm.js';
import { runLauncher } from './core/launcher.js';

const params = new URLSearchParams(location.search);
const capture = params.get('capture') === '1';
// Deterministic shutter for the pixel gate: the engine does not schedule its own
// frames, the driver advances exactly N of them through window.__PUMP__. Opt-in,
// because tools that measure real frame pacing (tools/perf.mjs) need the loop to
// free-run. See the long comment in src/dev/shots.js.
const lockstep = capture && params.get('lockstep') === '1';

const canvas = document.getElementById('game');

/*
 * Boot splash.
 *
 * In capture mode the node is removed outright rather than faded: an overlay
 * mid-transition would composite into the shot, and boot-duration couplings
 * leaking into pixels is exactly the class of bug the prewarm notes below
 * describe. Nothing about the splash may depend on wall-clock timing.
 */
const bootEl = document.getElementById('sl-boot');
let bootFill = document.getElementById('sl-fill');
let bootStatus = document.getElementById('sl-status');
if (capture) bootEl?.remove();

const setBoot = (pct, label) => {
  if (!bootEl || capture) return;
  if (bootFill) bootFill.style.width = `${Math.round(pct * 100)}%`;
  if (bootStatus && label) bootStatus.textContent = label;
};

const dismissBoot = () => {
  if (!bootEl || capture) return;
  setBoot(1, 'Ready');
  bootEl.classList.add('sl-done');
  // Matches the 0.55s CSS transition; removing it frees the compositor layer.
  setTimeout(() => bootEl.remove(), 700);
};

setBoot(0.05, 'Loading systems');

/*
 * Ask before spending. Boot generates every texture, mesh and shader in the
 * game, and that cost scales with the preset — so on a machine that cannot
 * cope, committing first and offering the quality controls afterwards means
 * the tab appears to hang with no way to intervene. The launcher runs before
 * engine construction and is skipped entirely for capture, an explicit ?q=,
 * or ?launch=0.
 */
const launch = await runLauncher({ capture, params, root: bootEl });
if (launch.shown) {
  // The launcher rebuilt the progress readout when it dismissed itself.
  bootFill = document.getElementById('sl-fill');
  bootStatus = document.getElementById('sl-status');
}

const config = createConfig({
  // `ultra` is a benchmark setting, not a sane default for whoever opens the
  // link — it is the preset that makes the game look like it never loads on
  // mid-range hardware. Capture keeps ultra so shots stay comparable with the
  // existing baselines; everyone else gets something that actually runs, and
  // can opt up with ?q=ultra.
  quality: launch.quality ?? (capture ? 'ultra' : 'medium'),
  // ?rs=0.35 pins the internal buffer below whatever the preset asks for.
  renderScaleOverride: launch.renderScale ?? null,
  deterministic: capture,
});


const engine = new Engine({ canvas, config });

// Registration order is irrelevant — Registry topo-sorts on static deps.
engine
  .add(RenderSystem)
  .add(MaterialSystem)
  .add(SkySystem)
  .add(WorldSystem)
  .add(PhysicsSystem)
  .add(PlayerSystem)
  .add(WeaponSystem)
  .add(FxSystem)
  .add(AiSystem)
  .add(UiSystem)
  .add(AudioSystem);

try {
  await engine.init();
  setBoot(0.6, 'Compiling shaders');
} catch (err) {
  console.error('[boot] init failed', err);
  if (bootStatus) bootStatus.textContent = 'Boot failed';
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="position:fixed;inset:0;padding:2rem;color:#f66;background:#000;
       font:12px/1.5 ui-monospace,monospace;overflow:auto;z-index:9999;white-space:pre-wrap">
BOOT FAILURE\n\n${err.stack ?? err.message}</pre>`
  );
  throw err;
}

const shotApi = installShotApi(engine, { capture, lockstep });

// Compile every shader permutation before the frame loop starts. Measured: without
// this, 86 programs compile lazily during play, up to 30 on one frame, producing
// 3.1-3.9 SECOND stalls. See src/core/prewarm.js.
//
// ON BY DEFAULT since the capture path was made frame-deterministic; opt out with
// `?prewarm=0`. It is now PROVEN pixel-neutral: `tools/baseline.mjs` with
// `--query=prewarm=0` vs `--query=prewarm=1` reports identical:true on all 11
// shots (0 changed pixels, maxDelta 0). The two things that previously made the
// ~1.4 s pre-warm spend look like a visual change were both boot-duration
// couplings OUTSIDE the subsystems: (1) the shutter frame index was latency-bound
// because the engine kept stepping through the driver's round trips — fixed by
// lockstep in src/dev/shots.js; (2) `will-change: transform` on the compass strip
// cached a composited-layer raster taken at a wall-clock-dependent moment — fixed
// in src/ui/style.js.
const warmup = params.get('prewarm') === '0' ? { ok: false, reason: 'disabled by ?prewarm=0' } : await prewarm(engine);
console.info('[boot] prewarm', warmup);
window.__PREWARM__ = warmup;
setBoot(0.92, 'Entering theatre');

engine.start();

// Capture harness handshake: only flag ready once a frame has actually landed.
//
// BOOT_FRAMES is deliberately a frame COUNT, not a rAF race. In lockstep mode the
// engine has no loop of its own, so we hand-pump exactly this many frames and only
// then raise __READY__; the shot is therefore always applied at engine frame 3, no
// matter how long boot (or pre-warm) took in wall-clock terms.
const BOOT_FRAMES = 3;
if (lockstep) {
  await shotApi.pump(BOOT_FRAMES);
  window.__READY__ = true;
  dismissBoot();
} else {
  let warm = 0;
  const readyProbe = () => {
    if (++warm >= BOOT_FRAMES) {
      window.__READY__ = true;
      dismissBoot();
      return;
    }
    requestAnimationFrame(readyProbe);
  };
  requestAnimationFrame(readyProbe);
}

window.__ENGINE__ = engine;

if (import.meta.hot) {
  import.meta.hot.dispose(() => engine.dispose());
}
