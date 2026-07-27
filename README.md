# Strike Legion

A browser first-person shooter — Three.js r180 + WebGL2, every asset generated
procedurally at load time.

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

Click the canvas to lock the cursor. **WASD** move · **mouse** aim · **LMB** fire ·
**RMB** ADS · **R** reload · **Shift** sprint · **Ctrl** crouch · **Space** jump ·
**Q/E** lean · **Esc** pause.

---

## Fork changes

This repository is a port of
[mshumer/Claude-of-Duty](https://github.com/mshumer/Claude-of-Duty), used under the
MIT License (see `LICENSE`, © 2026 mshumer). The upstream project is the original
work. Changes made here:

**Branding — Strike Legion.** Boot splash with the SL chevron lockup, window title,
pause-menu lockup, and a persistent low-ink HUD watermark.

**House design language.** The HUD and menus were restyled onto a system-native
type ramp (SF on Apple hardware, the platform stack elsewhere) set mostly in
sentence case, with hierarchy carried by weight and optical size rather than
letterspaced uppercase. The pause menu is a centred frosted card with a single
accent colour, an iOS-style segmented control, and round-knob sliders.
*No third-party trademarks or logos are used — this is a design language, not a
brand association.*

**Strike Legion field hardware in-world.** Milled-aluminium-and-glass display
panels, tablets and comms pods (`src/world/props.js`), deliberately sparse so the
deployed kit contrasts against a street built from rust and splinters.

**Two rendering fixes to the viewmodel**, which every upstream critic round flagged
as the weakest element in frame:

- *Self-shadowing.* All five view-scene rig lights and every viewmodel and hand
  mesh had `castShadow = false`, so the weapon received five unshadowed lobes and
  had no form at all — no occlusion under the handguard, none cast across the
  receiver by the optic, no separation between individually-modelled fingers. The
  key light now casts within the view scene (never into the world cascades).
- *Lighting ratio.* Fill + rim + hemisphere + bounce summed to **1.30× the key** —
  more fill than key, which is how you light a subject to remove its form. Retuned
  to 0.72× (key:fill ≈ 1.4:1), which also drops viewmodel irradiance ~25%. That is
  the same direction as the upstream note recording that a sleeve at *zero albedo*
  still rendered cream, i.e. F0=0.04 specular alone was carrying the surface.

Measured in isolation, the shadow change moved 1.08% of pixels and the ratio fix
7.43% — the two are the same defect seen from different sides, and sequencing them
separately is what isolated that.

**Portable capture harness.** The tooling assumed an Apple-silicon host and could
not produce a frame anywhere else. `tools/gpuargs.mjs` centralises the Chromium GPU
flags (Metal on macOS, SwiftShader elsewhere); `tools/grab.mjs` captures via CDP
`Page.captureScreenshot`, because Playwright's `page.screenshot()` awaits
`document.fonts.ready`, which never settles in a container with no system fonts;
Playwright is pinned to 1.56.0 to match the available Chromium build; and
`shotset.mjs` boot timeout is now configurable, 90s being a coin flip under
software rasterisation.

### Honest status

Upstream's own assessment — eleven adversarial critics, blind A/B against real
Call of Duty frames, ceiling 5.05/10, every critic picking the real frame every
round — still stands. The fixes above improve the weakest element; they do not
change that verdict. The binding constraints are structural: zero art assets, no
real GI, and a browser frame budget.

---

## Upstream README

A first-person shooter built in the browser with Three.js r180 and WebGL2. Roughly
55k lines across 11 subsystems, written by a fleet of AI agents under orchestration.

**There are no art assets.** Every texture, mesh, animation and sound is generated
procedurally at load time from code. No models, no HDRIs, no image files, no audio
files. The only runtime dependency is `three`.

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

Click the canvas to lock the cursor. WASD move, mouse aim, LMB fire, RMB ADS,
R reload, Shift sprint, Ctrl crouch, Space jump, Q/E lean, Esc release.

## What's in it

| subsystem | what it does |
|---|---|
| `render` | HDR pipeline, cascaded shadow maps in a `sampler2DArray` with texel snapping and PCSS contact hardening, MRT depth/normal/velocity prepass, GTAO, TAA with YCoCg variance clipping, tile-dilated motion blur, Karis bloom pyramid, GPU EV100 metering, procedural 33³ grade LUT, AgX composite |
| `materials` | GPU texture forge: 19 procedural surfaces (concrete, brick, plaster, asphalt, sand, rusted/painted/brushed metal, wood, fabric, burlap, glass…), periodic noise so everything tiles seamlessly, Sobel height→normal, parallax occlusion mapping, triplanar projection, curvature-driven edge wear |
| `sky` | Atmospheric scattering, time of day, PMREM environment generation, volumetric fog and light shafts |
| `world` | ~120×120 m market street: modular building kit with real wall thickness, enterable interiors, several hundred instanced props |
| `physics` | Written from scratch, no library. Binned-SAH BVH (29k tris → 14k nodes in 22 ms, 0.25 µs/raycast), swept-capsule character controller with a 5-plane crease stack, impulse rigid bodies with CCD, PBD ragdolls, multi-layer bullet penetration |
| `player` | Movement state machine, slide/mantle/lean, camera feel |
| `weapons` | Procedural weapon geometry, viewmodel rig, ADS, spring recoil, procedural reloads, ballistics with travel time and drop |
| `fx` | GPU particles, decals, tracers, muzzle flash, explosions |
| `ai` | Skinned soldiers, navmesh pathing, perception, cover behaviour, ragdoll death |
| `ui` | DOM/CSS HUD: crosshair, hitmarkers, minimap, compass, killfeed |
| `audio` | Web Audio synthesis — no sound files. Layered weapon fire, convolution reverb, HRTF spatialisation, occlusion |

`ARCHITECTURE.md` is the contract the agents worked against: subsystem interface,
directory ownership, the cross-subsystem event vocabulary, and shared surface types.

## Tooling

The interesting part of this repo is arguably the harness, not the game.

| tool | purpose |
|---|---|
| `tools/capture.mjs` | Screenshot one named shot via GPU-backed headless Chromium |
| `tools/shotset.mjs` | All 11 shots in one session — fast review set |
| `tools/baseline.mjs` | **Reproducible** capture: each shot in an isolated page, fixed frame budget. Bit-identical across runs |
| `tools/imagediff.mjs` | Per-pixel gate. Exits non-zero if any pixel moved |
| `tools/profile.mjs` | Gameplay profiler at real device pixel ratio. Frame-time *distribution* and hitch attribution via per-frame WebGL program counts |
| `tools/playtest.mjs` | Scripted movement/fire smoke test |

Two findings worth recording, because both invalidated earlier measurements:

**Median frame time hides the actual problem.** A static-camera benchmark reported
94 fps while the game was unplayable. Real gameplay at Retina DPR (internal 3.34 MP,
not 2.07) ran 12–17 fps with **728–1236 ms stalls** caused by 34+ WebGL programs
compiling lazily mid-frame. `profile.mjs` reports p50/p95/p99 and attributes each
hitch, which is what surfaced it.

**Captures were not reproducible.** `shotset.mjs` reuses one page across all 11
shots, so particle age, decal buffers and exposure state leak forward — two identical
runs differed on 10 of 11 shots. `baseline.mjs` isolates each shot in a fresh page,
which is bit-identical and is what makes `imagediff.mjs` a usable gate.

## Performance

Measured on an Apple silicon laptop at 1512×982, DPR 2 (3.34 MP internal), `ultra` preset,
3 runs, gameplay in motion with AI and firing active:

| | before optimization | after |
|---|---|---|
| fps p50 | 12–17 | **28–30** |
| fps p99 | 4–9 | **14–17** |
| worst frame | 728–1236 ms | **66–82 ms** |
| shader compiles during play | 34–35 | **0** |
| boot | ~9–12 s | **3.7–4.6 s** |

The optimization pass was constrained to produce **zero visual change**, enforced by
`imagediff.mjs` rather than by assertion — the shipped build is bit-identical to its
pre-optimization reference across all 11 shots.

Shader pre-warm (`src/core/prewarm.js`) is what removed the stalls. Making it
*provably* pixel-neutral required first fixing subsystems that animated off
`performance.now()` instead of the engine clock, since any change to boot duration
otherwise shifted output.

## Honest assessment

The goal was to match a modern Call of Duty. **It does not.**

Eleven independent adversarial critics scored the frames against that bar. Scores
went 3.59 → 4.14 → 4.05 → **5.05** out of 10. Two shots reached "CLOSE"; the rest
remain "AMATEUR". In a blind A/B, **every critic in every round picked the real Call
of Duty frame.**

Where it falls short, specifically:

- **Hands.** Blocky finger slabs that don't convincingly grip the weapon.
- **Material richness.** Surfaces read as procedural noise rather than photographed
  reality at close range — the ceiling of generating texture from code.
- **Characters.** Enemies read as mannequins at distance.
- **Indirect light.** An approximation, not real GI.
- **Frame rate.** 28–30 fps at Retina. The art passes tripled geometry cost
  (5.9M → 11.3M triangles) and optimization recovered about half.

A known root cause remains unfixed: the viewmodel light rig in `render/index.js`
delivers roughly 20× the irradiance per unit albedo that the world does — a plain
*black* material in the view scene renders at L=110 against a background of 91,
purely from F0=0.04. Every weapon albedo is cheated to a third of physical to
compensate, which caps material separation on the most-looked-at object in the game.

## Process note

Sequential single-owner passes beat parallel fan-out decisively. Three rounds of six
agents each owning one directory moved the score +0.46 and left frame-ruining defects
*higher* than they started (60 → 47 → 66), because tonemapping, sky and indirect light
are one coupled system and isolated agents kept breaking each other's assumptions.
One sequential pass with a single owner per coupled concern moved it +1.00 and cut
defects 66 → 26.

The most valuable single result came from an agent contradicting its own brief. Every
critic for three rounds reported the weapon as "untextured". It wasn't — it was
specular-dominated, with the diffuse term measured at L=26 against a shipped L=67.
Prior rounds had been crushing albedos to fight bright-part complaints, which killed
diffuse and made it worse. The fix was the opposite of what was asked for.
