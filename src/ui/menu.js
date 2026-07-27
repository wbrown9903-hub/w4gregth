import { el, setText, setStyle, clamp, damp, ease } from './util.js';

const PRESETS = ['potato', 'low', 'medium', 'high', 'ultra'];

/**
 * Pause / settings menu.
 *
 * Wired straight into `ctx.config`: the quality segments call
 * `config.setQuality`, the sliders write `config.sensitivity` and `config.fov`
 * (and push the FOV into the live camera), and every change is announced on the
 * event bus so render/player can react without importing this module.
 *
 * Events emitted: `ui:pause` {paused}, `ui:quality` {quality},
 * `ui:sensitivity` {value}, `ui:fov` {value}, `ui:setting` {key, value}.
 */
export class PauseMenu {
  constructor(parent, ctx) {
    this.ctx = ctx;
    this.root = el('div', 'ow-menu', parent);
    const inner = el('div', 'ow-menu-inner', this.root);

    // Brand lockup. SVG has to go in as markup — `el` builds HTML elements and
    // createElement('svg') would land in the wrong namespace.
    const brand = el('div', 'ow-brand', inner);
    brand.innerHTML =
      '<svg class="ow-brand-mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">' +
      '<rect x="1.5" y="1.5" width="45" height="45" rx="13" stroke="currentColor" ' +
      'stroke-opacity=".32" stroke-width="2.2"/>' +
      '<path d="M15 30.5 L24 15 L33 30.5" stroke="currentColor" stroke-width="3.4" ' +
      'stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M18.5 35.5 H33" stroke="currentColor" stroke-opacity=".58" ' +
      'stroke-width="3" stroke-linecap="round"/></svg>' +
      '<span class="ow-brand-word">Strike<em>Legion</em></span>';

    const h = el('h1', null, inner, 'Paused');
    h.textContent = 'Paused';
    el('div', 'sub', inner, 'Tactical Operations');
    el('div', 'rule', inner);

    this.rows = el('div', null, inner);

    // ---- quality preset --------------------------------------------------
    this.qBtns = [];
    const qRow = this._row('Graphics Preset');
    const seg = el('div', 'ow-seg', qRow);
    for (const p of PRESETS) {
      const b = el('button', null, seg, p);
      b.type = 'button';
      b.addEventListener('click', () => this.setQuality(p));
      this.qBtns.push(b);
    }

    // ---- sensitivity -----------------------------------------------------
    this.sens = this._slider('Mouse Sensitivity', 0.2, 3.0, 0.01, (v) => {
      this.ctx.config.sensitivity = 0.0022 * v;
      this.ctx.events.emit('ui:sensitivity', { value: this.ctx.config.sensitivity, multiplier: v });
      return v.toFixed(2);
    }, (v) => v.toFixed(2));

    // ---- resolution scale ------------------------------------------------
    // Independent of the preset, because resolution is the dominant cost in
    // this renderer and it is the knob people actually need when a machine
    // cannot cope. Applying it resizes every render target, so it is pushed
    // through the engine's normal resize path rather than poked in directly.
    this.rscale = this._slider('Resolution Scale', 0.25, 1.0, 0.05, (v) => {
      const applied = this.ctx.config.setRenderScale(v);
      this.ctx.events.emit('ui:renderscale', { value: applied });
      return `${Math.round(applied * 100)}%`;
    }, (v) => `${Math.round(v * 100)}%`);

    // ---- field of view ---------------------------------------------------
    this.fov = this._slider('Field Of View', 65, 120, 1, (v) => {
      this.ctx.config.fov = v;
      const cam = this.ctx.camera;
      if (cam) {
        cam.fov = v;
        cam.updateProjectionMatrix();
      }
      this.ctx.events.emit('ui:fov', { value: v });
      return String(v | 0);
    }, (v) => String(v | 0));

    // ---- invert look -----------------------------------------------------
    const invRow = this._row('Invert Look');
    const invSeg = el('div', 'ow-seg', invRow);
    this.invBtns = [];
    for (const [label, val] of [
      ['off', false],
      ['on', true],
    ]) {
      const b = el('button', null, invSeg, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        this.ctx.config.invertY = val;
        this.ctx.events.emit('ui:setting', { key: 'invertY', value: val });
        this.syncFromConfig();
      });
      this.invBtns.push([b, val]);
    }

    // ---- buttons ---------------------------------------------------------
    const btns = el('div', 'ow-btns', inner);
    this.resumeBtn = el('button', 'ow-btn primary', btns, 'Resume');
    this.resumeBtn.type = 'button';
    this.resumeBtn.addEventListener('click', () => this.close());
    const reset = el('button', 'ow-btn', btns, 'Defaults');
    reset.type = 'button';
    // Writes config directly rather than driving the sliders: slider.set() is
    // deliberately silent, so poking it would move the handle without changing
    // anything. syncFromConfig then pulls the handles back into agreement.
    reset.addEventListener('click', () => {
      const cfg = this.ctx.config;
      cfg.sensitivity = 0.0022;
      cfg.fov = 80;
      if (this.ctx.camera) {
        this.ctx.camera.fov = 80;
        this.ctx.camera.updateProjectionMatrix();
      }
      cfg.invertY = false;
      cfg.setRenderScale(null); // hand resolution back to the preset
      this.ctx.events.emit('ui:sensitivity', { value: cfg.sensitivity, multiplier: 1 });
      this.ctx.events.emit('ui:fov', { value: 80 });
      // 'medium', not 'ultra' — ultra is a benchmark setting, and resetting a
      // struggling machine onto it is how you make Defaults look like a crash.
      this.setQuality('medium');
      this.ctx.events.emit('ui:renderscale', { value: cfg.q.renderScale });
    });
    el('div', 'hint', inner, 'ESC RESUME · WASD MOVE · SHIFT SPRINT · R RELOAD · F USE');

    this.open = false;
    this.shown = 0;
    setStyle(this.root, 'display', 'none');
    setStyle(this.root, 'cursor', 'default');
    this.syncFromConfig();
  }

  _row(name) {
    const r = el('div', 'ow-row', this.rows);
    el('div', 'name', r, name.toUpperCase());
    return r;
  }

  /**
   * `apply` runs only on real user input and owns the side effect. `format`
   * renders the readout without one, so `set()` can reflect current config
   * without writing it back — which for Resolution Scale is the difference
   * between the slider showing the preset's value and permanently pinning it
   * the moment the menu is opened.
   */
  _slider(name, min, max, step, apply, format) {
    const row = this._row(name);
    const wrap = el('div', 'ow-slider', row);
    el('div', 'track', wrap);
    const fill = el('div', 'fill', wrap);
    const knob = el('div', 'knob', wrap);
    const input = el('input', null, wrap);
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const val = el('div', 'val', row, '');

    const paint = (v, silent) => {
      const t = (v - min) / (max - min);
      setStyle(fill, 'width', (t * 100).toFixed(2) + '%');
      setStyle(knob, 'left', (t * 100).toFixed(2) + '%');
      const label = silent ? format?.(v) ?? String(v) : apply(v) ?? String(v);
      setText(val, label);
    };
    input.addEventListener('input', () => paint(parseFloat(input.value), false));
    const api = {
      set: (v) => {
        const c = clamp(v, min, max);
        input.value = String(c);
        paint(c, true);
      },
    };
    return api;
  }

  setQuality(name) {
    try {
      this.ctx.config.setQuality(name);
      this.ctx.events.emit('ui:quality', { quality: name });
    } catch (err) {
      console.warn('[ui] quality switch failed', err);
    }
    this.syncFromConfig();
  }

  syncFromConfig() {
    const cfg = this.ctx.config;
    for (let i = 0; i < this.qBtns.length; i++)
      this.qBtns[i].classList.toggle('on', PRESETS[i] === cfg.quality);
    for (const [b, v] of this.invBtns) b.classList.toggle('on', !!cfg.invertY === v);
    this.sens?.set((cfg.sensitivity ?? 0.0022) / 0.0022);
    this.fov?.set(cfg.fov ?? 80);
    // Reflects the preset's own scale when nothing is pinned, so switching
    // preset visibly moves the slider instead of leaving it stale.
    this.rscale?.set(cfg.renderScaleOverride ?? cfg.q?.renderScale ?? 1);
  }

  toggle() {
    this.open ? this.close() : this.show();
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.syncFromConfig();
    setStyle(this.root, 'display', '');
    document.exitPointerLock?.();
    const t = this.ctx.time;
    if (t) {
      this._prevScale = t.scale;
      t.scale = 0;
    }
    this.ctx.peek('player')?.setControlEnabled?.(false);
    this.ctx.events.emit('ui:pause', { paused: true });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    const t = this.ctx.time;
    if (t) t.scale = this._prevScale ?? 1;
    this.ctx.peek('player')?.setControlEnabled?.(true);
    this.ctx.input?.requestPointerLock?.();
    this.ctx.events.emit('ui:pause', { paused: false });
  }

  /** Driven with unscaled time so the fade still runs while the game is frozen. */
  update(rawDt) {
    this.shown = damp(this.shown, this.open ? 1 : 0, 14, rawDt);
    if (this.shown < 0.004) {
      setStyle(this.root, 'display', 'none');
      setStyle(this.root, 'pointer-events', 'none');
      return;
    }
    setStyle(this.root, 'display', '');
    setStyle(this.root, 'pointer-events', this.open ? 'auto' : 'none');
    setStyle(this.root, 'opacity', ease.outQuad(this.shown).toFixed(3));
  }

  dispose() {
    this.root.remove();
  }
}
