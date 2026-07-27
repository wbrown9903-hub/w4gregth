/**
 * Central tuning + quality configuration.
 * Subsystems read from here rather than hardcoding magic numbers, so the
 * quality scaler and the capture harness can drive everything from one place.
 */

export const PHYSICS_HZ = 120;
export const FIXED_DT = 1 / PHYSICS_HZ;
/** Never simulate more than this many physics steps in one frame (spiral-of-death guard). */
export const MAX_SUBSTEPS = 8;

/** Real-world units are metres, seconds, kilograms. */
export const UNITS = {
  gravity: -9.81 * 2.1, // Games use exaggerated gravity; CoD-like feel.
  playerHeight: 1.78,
  playerCrouchHeight: 1.12,
  playerRadius: 0.32,
  eyeOffset: 0.12, // below top of capsule
};

export const QUALITY_PRESETS = {
  /**
   * Absolute floor. Everything optional is off and the internal buffer is 40%
   * of display width — roughly a sixth of the pixels of `high`. This exists so
   * the game runs at all on integrated graphics and old laptops; it is not
   * meant to look good, and it will be visibly soft.
   */
  potato: {
    renderScale: 0.4,
    shadowMapSize: 512,
    cascades: 1,
    shadowDistance: 28,
    taa: false,
    gtao: false,
    ssr: false,
    volumetrics: false,
    motionBlur: false,
    bloom: false,
    anisotropy: 1,
    particleBudget: 400,
    decalBudget: 24,
  },
  low: {
    renderScale: 0.72,
    shadowMapSize: 1024,
    cascades: 3,
    shadowDistance: 60,
    taa: false,
    gtao: false,
    ssr: false,
    volumetrics: false,
    motionBlur: false,
    bloom: true,
    anisotropy: 4,
    particleBudget: 2000,
    decalBudget: 64,
  },
  medium: {
    renderScale: 0.85,
    shadowMapSize: 2048,
    cascades: 3,
    shadowDistance: 90,
    taa: true,
    gtao: true,
    ssr: false,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    anisotropy: 8,
    particleBudget: 6000,
    decalBudget: 128,
  },
  high: {
    renderScale: 1.0,
    shadowMapSize: 2048,
    cascades: 4,
    shadowDistance: 140,
    taa: true,
    gtao: true,
    ssr: true,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    anisotropy: 16,
    particleBudget: 12000,
    decalBudget: 256,
  },
  ultra: {
    renderScale: 1.0,
    shadowMapSize: 4096,
    cascades: 4,
    shadowDistance: 200,
    taa: true,
    gtao: true,
    ssr: true,
    volumetrics: true,
    motionBlur: true,
    bloom: true,
    anisotropy: 16,
    particleBudget: 24000,
    decalBudget: 512,
  },
};

export const DEFAULTS = {
  quality: 'ultra',
  fov: 80, // horizontal-ish vertical FOV, CoD default feel
  adsFovScale: 0.72,
  sensitivity: 0.0022,
  adsSensScale: 0.65,
  invertY: false,
  exposure: 1.0,
  /** Capture mode disables anything nondeterministic so screenshots are stable. */
  deterministic: false,
};

/** Hard floor on the internal buffer. Below this the HUD stops being readable. */
export const MIN_RENDER_SCALE = 0.25;
export const MAX_RENDER_SCALE = 1.0;

export function createConfig(overrides = {}) {
  const cfg = { ...DEFAULTS, ...overrides };
  // The initial preset can come straight off a query string, so it is not
  // trustworthy. Unvalidated, `?q=anything` spread `undefined` into cfg.q and
  // every renderer setting silently became undefined — a black screen with no
  // error, which is a miserable thing to debug from a bug report.
  if (!QUALITY_PRESETS[cfg.quality]) {
    console.warn(`[config] unknown quality "${cfg.quality}", falling back to medium`);
    cfg.quality = 'medium';
  }
  cfg.q = { ...QUALITY_PRESETS[cfg.quality] };

  /**
   * Resolution is the single biggest cost in this renderer and it is the one
   * knob people actually need when a machine cannot cope, so it is adjustable
   * independently of the preset rather than being locked to it. null means
   * "follow the preset"; any number pins it until cleared.
   */
  cfg.renderScaleOverride =
    overrides.renderScaleOverride != null ? clampScale(overrides.renderScaleOverride) : null;

  const applyScale = () => {
    if (cfg.renderScaleOverride != null) cfg.q.renderScale = cfg.renderScaleOverride;
  };
  applyScale();

  cfg.setQuality = (name) => {
    if (!QUALITY_PRESETS[name]) throw new Error(`unknown quality preset "${name}"`);
    cfg.quality = name;
    Object.assign(cfg.q, QUALITY_PRESETS[name]);
    // A preset carries its own renderScale, so re-pin the override on top.
    applyScale();
  };

  /** Pass null to hand resolution back to the active preset. */
  cfg.setRenderScale = (v) => {
    cfg.renderScaleOverride = v == null ? null : clampScale(v);
    cfg.q.renderScale =
      cfg.renderScaleOverride ?? QUALITY_PRESETS[cfg.quality].renderScale;
    return cfg.q.renderScale;
  };

  return cfg;
}

function clampScale(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return MIN_RENDER_SCALE;
  return Math.min(MAX_RENDER_SCALE, Math.max(MIN_RENDER_SCALE, n));
}
