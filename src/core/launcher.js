/**
 * Pre-boot launcher.
 *
 * The expensive part of starting this game is not downloading it — the whole
 * bundle is ~1.6 MB and there are no art assets at all. The cost is generating
 * them: texture bakes, world construction and shader compilation, all of which
 * happen before the first frame and all of which scale hard with the quality
 * preset.
 *
 * That ordering is the problem this screen solves. Previously the preset was
 * fixed before anyone could touch it, so a laptop that could not cope committed
 * to the expensive path and then appeared to hang — with no way to intervene,
 * because the UI that changes quality only exists after boot finishes.
 *
 * So: pick first, then pay. The recommendation comes from the GPU string, and
 * the choice is remembered, so this is a one-time interaction per machine.
 */

const STORE_KEY = 'strikelegion.launch.v1';

/** Presets in ascending cost. Kept in step with QUALITY_PRESETS. */
const TIERS = [
  { id: 'potato', label: 'Minimum', blurb: 'Lowest resolution, no effects. For old or integrated graphics.' },
  { id: 'low', label: 'Low', blurb: 'Reduced resolution, shadows only.' },
  { id: 'medium', label: 'Medium', blurb: 'Balanced. Good on most laptops from the last few years.' },
  { id: 'high', label: 'High', blurb: 'Native resolution, reflections and ambient occlusion.' },
  { id: 'ultra', label: 'Ultra', blurb: 'Everything on. Wants a discrete GPU.' },
];

/**
 * Guess a starting preset from the GPU string and the machine's core count.
 *
 * This is a heuristic and it is allowed to be wrong — it only sets where the
 * selector starts, and the player can override it before launching. It errs
 * low deliberately: someone on a fast machine notices a soft image immediately
 * and turns it up, whereas someone on a slow machine who is handed `ultra`
 * just sees a frozen tab and closes it.
 */
export function detectTier() {
  let renderer = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && dbg) renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* blocked by privacy settings — fall through to the conservative default */
  }

  const r = renderer.toLowerCase();
  const cores = navigator.hardwareConcurrency || 4;

  // Software rasterisers: nothing will make this pleasant, but `potato` at
  // least reaches a playable frame.
  if (/swiftshader|llvmpipe|softwarepipe|basic render/.test(r)) {
    return { tier: 'potato', renderer, reason: 'software rendering detected' };
  }
  // Phones and tablets.
  if (/mali|adreno|powervr|videocore/.test(r)) {
    return { tier: 'potato', renderer, reason: 'mobile graphics' };
  }
  // Apple silicon is comfortably capable; the integrated/discrete split does
  // not apply the way it does on PC.
  if (/apple m\d/.test(r)) {
    return { tier: 'high', renderer, reason: 'Apple silicon' };
  }
  // Discrete PC GPUs.
  if (/rtx|geforce gtx 1[6-9]|geforce rtx|radeon rx|arc a\d/.test(r)) {
    return { tier: 'high', renderer, reason: 'discrete GPU' };
  }
  // Intel integrated — the common laptop case, and the one that struggles.
  if (/intel|uhd graphics|hd graphics|iris/.test(r)) {
    return { tier: /iris xe|arc/.test(r) ? 'low' : 'potato', renderer, reason: 'integrated graphics' };
  }
  // Unknown. Go by core count and stay conservative.
  return { tier: cores >= 8 ? 'medium' : 'low', renderer, reason: 'unrecognised GPU' };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(v) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
  } catch {
    /* private mode — the choice just will not persist */
  }
}

/**
 * Show the launcher and resolve with `{ quality, renderScale }`.
 *
 * Resolves immediately without showing anything when the caller has already
 * decided: capture runs, an explicit ?q= in the URL, or ?launch=0.
 */
export function runLauncher({ capture, params, root }) {
  const explicit = params.get('q');
  const skip = capture || params.get('launch') === '0';

  if (skip || explicit) {
    const saved = load();
    return Promise.resolve({
      quality: explicit || saved?.quality || null,
      renderScale: params.get('rs') != null ? Number(params.get('rs')) : saved?.renderScale ?? null,
      shown: false,
    });
  }

  const host = root || document.getElementById('sl-boot');
  if (!host) return Promise.resolve({ quality: null, renderScale: null, shown: false });

  const saved = load();
  const detected = detectTier();
  let tier = saved?.quality || detected.tier;
  let scale = saved?.renderScale ?? null;

  return new Promise((resolve) => {
    const panel = document.createElement('div');
    panel.className = 'sl-launcher';
    panel.innerHTML = `
      <div class="sl-lch-head">
        <div class="sl-lch-title">Graphics</div>
        <div class="sl-lch-sub" id="sl-lch-note"></div>
      </div>
      <div class="sl-lch-tiers" id="sl-lch-tiers"></div>
      <div class="sl-lch-blurb" id="sl-lch-blurb"></div>
      <label class="sl-lch-scale">
        <span>Resolution</span>
        <input type="range" id="sl-lch-rs" min="0.25" max="1" step="0.05">
        <b id="sl-lch-rsv"></b>
      </label>
      <button class="sl-lch-go" id="sl-lch-go" type="button">Play</button>
      <div class="sl-lch-foot">Change any of this later with Esc. Settings are remembered.</div>
    `;

    // Replace the loading stack, keep the brand lockup above it.
    host.querySelector('.sl-track')?.remove();
    host.querySelector('.sl-status')?.remove();
    host.querySelector('.sl-boot-stack')?.appendChild(panel);

    const tiersEl = panel.querySelector('#sl-lch-tiers');
    const blurbEl = panel.querySelector('#sl-lch-blurb');
    const noteEl = panel.querySelector('#sl-lch-note');
    const rs = panel.querySelector('#sl-lch-rs');
    const rsv = panel.querySelector('#sl-lch-rsv');

    noteEl.textContent = saved
      ? 'Using your last settings.'
      : `Suggested for this machine — ${detected.reason}.`;

    const buttons = TIERS.map((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t.label;
      b.addEventListener('click', () => {
        tier = t.id;
        // A preset switch resets the resolution override; otherwise picking
        // Ultra while a 25% scale is pinned quietly gives neither.
        scale = null;
        paint();
      });
      tiersEl.appendChild(b);
      return b;
    });

    const defaultScaleFor = (id) =>
      ({ potato: 0.4, low: 0.72, medium: 0.85, high: 1, ultra: 1 })[id] ?? 1;

    function paint() {
      const t = TIERS.find((x) => x.id === tier) ?? TIERS[2];
      buttons.forEach((b, i) => b.classList.toggle('on', TIERS[i].id === tier));
      blurbEl.textContent = t.blurb;
      const s = scale ?? defaultScaleFor(tier);
      rs.value = String(s);
      rsv.textContent = `${Math.round(s * 100)}%`;
    }

    rs.addEventListener('input', () => {
      scale = parseFloat(rs.value);
      rsv.textContent = `${Math.round(scale * 100)}%`;
    });

    panel.querySelector('#sl-lch-go').addEventListener('click', () => {
      const out = { quality: tier, renderScale: scale ?? defaultScaleFor(tier) };
      save(out);
      panel.remove();
      // Put the progress readout back for the boot that follows.
      const stack = host.querySelector('.sl-boot-stack');
      if (stack) {
        stack.insertAdjacentHTML(
          'beforeend',
          '<div class="sl-track"><div class="sl-fill" id="sl-fill"></div></div>' +
            '<div class="sl-status" id="sl-status">Starting</div>'
        );
      }
      resolve({ ...out, shown: true });
    });

    paint();
  });
}
