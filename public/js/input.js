// Controls: one button rotates (hold), one fires (tap). Double-tap rotate = dash.
// A dash needs a quick tap followed by a quick re-press, so holding to aim never dashes by accident.
const DOUBLE_TAP_GAP_MS = 200, TAP_MAX_MS = 170;

class Controller {
  constructor() { this.reset(); }
  reset() { this.sources = new Set(); this.fireHeld = new Set(); this.fireQ = 0; this.dashQ = 0; this.pressAt = -1e9; this.releaseAt = -1e9; this.tapped = false; }
  rotDown(src) {
    if (this.sources.has(src)) return;
    if (!this.sources.size) {
      const now = performance.now();
      if (this.tapped && now - this.releaseAt < DOUBLE_TAP_GAP_MS) { this.dashQ = 1; this.tapped = false; }
      this.pressAt = now;
    }
    this.sources.add(src);
  }
  rotUp(src) {
    if (!this.sources.delete(src) || this.sources.size) return;
    const now = performance.now();
    this.tapped = now - this.pressAt < TAP_MAX_MS;
    this.releaseAt = now;
  }
  fire() { this.fireQ = 1; }
  fireDown(src) { if (!this.fireHeld.has(src)) { this.fireHeld.add(src); this.fire(); } }
  fireUp(src) { this.fireHeld.delete(src); }
  sample() {
    const i = { r: this.sources.size ? 1 : 0, f: this.fireQ, d: this.dashQ, h: this.fireHeld.size ? 1 : 0 };
    this.fireQ = 0; this.dashQ = 0;
    return i;
  }
}

// Keyboard pairs for local play. Player 1 uses the arrow keys.
const KEYMAPS = [
  { rot: 'ArrowRight', fire: 'ArrowDown', label: ['→', '↓'] },
  { rot: 'KeyQ', fire: 'KeyW', label: ['Q', 'W'] },
  { rot: 'KeyC', fire: 'KeyV', label: ['C', 'V'] },
  { rot: 'KeyO', fire: 'KeyP', label: ['O', 'P'] },
  { rot: 'Digit1', fire: 'Digit2', label: ['1', '2'] },
  { rot: 'KeyN', fire: 'KeyM', label: ['N', 'M'] },
];

const Input = {
  controllers: [],   // controllers[i] is driven by KEYMAPS[i]
  enabled: false,
  isTouch: matchMedia('(pointer: coarse)').matches,

  init() {
    const find = code => {
      for (let i = 0; i < this.controllers.length; i++) {
        const k = KEYMAPS[i];
        if (k.rot === code) return [this.controllers[i], 'rot'];
        if (k.fire === code) return [this.controllers[i], 'fire'];
      }
      return null;
    };
    addEventListener('keydown', e => {
      if (!this.enabled || e.target.tagName === 'INPUT') return;
      const hit = find(e.code);
      if (!hit) return;
      e.preventDefault();
      if (e.repeat) return;
      if (hit[1] === 'rot') hit[0].rotDown('k'); else hit[0].fireDown('k');
    });
    addEventListener('keyup', e => {
      const hit = find(e.code);
      if (hit && hit[1] === 'rot') hit[0].rotUp('k');
      if (hit && hit[1] === 'fire') hit[0].fireUp('k');
    });
    const releaseAll = () => this.controllers.forEach(c => { c.sources.clear(); c.fireHeld.clear(); });
    addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', releaseAll);
  },

  bind(list) { this.controllers = list; },

  // Wires a DOM element to a controller action, supporting multi-touch.
  wire(el, ctrl, action) {
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (_) { }
      el.classList.add('down');
      Sfx.unlock();
      if (action === 'rot') ctrl.rotDown('p' + e.pointerId); else ctrl.fireDown('p' + e.pointerId);
    });
    const up = e => {
      el.classList.remove('down');
      if (action === 'rot') ctrl.rotUp('p' + e.pointerId); else ctrl.fireUp('p' + e.pointerId);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', e => e.preventDefault());
  },

  // Online: left half of the screen rotates, right half fires.
  // One player on a phone (online or vs bots): Astro Party-style corner triangles —
  // rotate bottom-left, fire bottom-right. Each whole screen half is the touch area,
  // so the buttons are easy to hit without looking.
  buildTouchOnline(root, ctrl, color) {
    root.innerHTML = '';
    root.className = 'touch online';
    root.style.setProperty('--c', color);
    const mk = (cls, label) => {
      const z = document.createElement('div');
      z.className = 'zone ' + cls;
      z.innerHTML = `<div class="tri"><span>${label}</span></div>`;
      root.appendChild(z);
      return z;
    };
    this.wire(mk('left', ROT_ICON), ctrl, 'rot');
    this.wire(mk('right', FIRE_ICON), ctrl, 'fire');
  },

  // Local (Astro Party style): each player owns a screen corner — a big triangle split into
  // a rotate half and a fire half, turned to face whoever sits at that corner.
  buildTouchLocal(root, humans) {
    root.innerHTML = '';
    root.className = 'touch local';
    humans.forEach((h, i) => {
      const el = document.createElement('div');
      el.className = (i < 4 ? 'corner c' : 'pair pos') + i;
      el.style.setProperty('--c', h.color);
      if (i < 4) el.innerHTML = `<div class="tri rot"><span>${ROT_ICON}</span></div><div class="tri fire"><span>${FIRE_ICON}</span></div>`;
      else el.innerHTML = `<div class="btn rot">${ROT_ICON}</div><div class="btn fire">${FIRE_ICON}</div>`;
      root.appendChild(el);
      this.wire(el.querySelector('.rot'), h.ctrl, 'rot');
      this.wire(el.querySelector('.fire'), h.ctrl, 'fire');
    });
  },
};

const ROT_ICON = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>';
const FIRE_ICON = '<svg viewBox="0 0 24 24" width="34" height="34"><circle cx="12" cy="12" r="5" fill="currentColor"/><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
