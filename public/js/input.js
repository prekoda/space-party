// Controls: one button rotates (hold), one fires (tap). Double-tap rotate = dash.
const DOUBLE_TAP_MS = 260;

class Controller {
  constructor() { this.reset(); }
  reset() { this.sources = new Set(); this.fireQ = 0; this.dashQ = 0; this.lastPress = -1e9; }
  rotDown(src) {
    if (this.sources.has(src)) return;
    if (!this.sources.size) {
      const now = performance.now();
      if (now - this.lastPress < DOUBLE_TAP_MS) { this.dashQ = 1; this.lastPress = -1e9; }
      else this.lastPress = now;
    }
    this.sources.add(src);
  }
  rotUp(src) { this.sources.delete(src); }
  fire() { this.fireQ = 1; }
  sample() {
    const i = { r: this.sources.size ? 1 : 0, f: this.fireQ, d: this.dashQ };
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
  isTouch: matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window,

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
      if (hit[1] === 'rot') hit[0].rotDown('k'); else hit[0].fire();
    });
    addEventListener('keyup', e => {
      const hit = find(e.code);
      if (hit && hit[1] === 'rot') hit[0].rotUp('k');
    });
    const releaseAll = () => this.controllers.forEach(c => c.sources.clear());
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
      if (action === 'rot') ctrl.rotDown('p' + e.pointerId); else ctrl.fire();
    });
    const up = e => {
      el.classList.remove('down');
      if (action === 'rot') ctrl.rotUp('p' + e.pointerId);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', e => e.preventDefault());
  },

  // Online: left half of the screen rotates, right half fires.
  buildTouchOnline(root, ctrl, color) {
    root.innerHTML = '';
    root.className = 'touch online';
    const mk = (cls, label) => {
      const z = document.createElement('div');
      z.className = 'zone ' + cls;
      z.innerHTML = `<div class="pad" style="--c:${color}"><span>${label}</span></div>`;
      root.appendChild(z);
      return z;
    };
    this.wire(mk('left', ROT_ICON), ctrl, 'rot');
    this.wire(mk('right', FIRE_ICON), ctrl, 'fire');
  },

  // Local: each human gets a rotate/fire pair on their own edge of the tablet.
  buildTouchLocal(root, humans) {
    root.innerHTML = '';
    root.className = 'touch local';
    humans.forEach((h, i) => {
      const pair = document.createElement('div');
      pair.className = 'pair pos' + i;
      pair.style.setProperty('--c', h.color);
      pair.innerHTML = `<div class="btn rot">${ROT_ICON}</div><div class="btn fire">${FIRE_ICON}</div>`;
      root.appendChild(pair);
      this.wire(pair.querySelector('.rot'), h.ctrl, 'rot');
      this.wire(pair.querySelector('.fire'), h.ctrl, 'fire');
    });
  },
};

const ROT_ICON = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>';
const FIRE_ICON = '<svg viewBox="0 0 24 24" width="34" height="34"><circle cx="12" cy="12" r="5" fill="currentColor"/><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
