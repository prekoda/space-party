// Pixel-art renderer in the style of Astro Party.
// The world is drawn into a small buffer (1 px = 3 world units) and scaled up with
// nearest-neighbour filtering, so everything — ships, walls, particles — is crisp chunky pixels
// and the camera zoom simply makes the pixels bigger. Text and overlays are drawn on top.
const FONT = '"Press Start 2P", monospace';
const PX = 4;
const BW = Math.ceil(SP.W / PX), BH = Math.ceil(SP.H / PX);
const MAX_PARTS = 1000;

// ---------------------------------------------------------------- themes
// Each map theme paints its own ground and colours walls, blocks and hazards.
const THEMES = {
  space:   { name: 'Space',   bg: '#04040a', wall: ['#06060c', '#ff6a1f', '#8c2d0c'], block: ['#2b2b38', '#b4b4c8', '#7a7a8c', '#55556a'], hz: ['#ff3b3b', '#ffb3b3'] },
  nebula:  { name: 'Nebula',  bg: '#08041a', wall: ['#0b0618', '#c77dff', '#5a2a8c'], block: ['#2a1640', '#e0b3ff', '#9a5ad6', '#5e2f8f'], hz: ['#ff4dd8', '#ffc2f2'] },
  ice:     { name: 'Ice',     bg: '#173247', wall: ['#bfe9ff', '#ffffff', '#7cc7ea'], block: ['#3a7fa8', '#e8fbff', '#9fe0ff', '#62b2d8'], hz: ['#0b2f66', '#5fa8ff'] },
  lava:    { name: 'Lava',    bg: '#1a0806', wall: ['#2b1410', '#ff8a3a', '#7a2a10'], block: ['#1d1414', '#6b5555', '#3a2a2a', '#2a1d1d'], hz: ['#ff5a14', '#ffd23f'] },
  jungle:  { name: 'Jungle',  bg: '#0b1f1a', wall: ['#1f2b24', '#7ee08a', '#2f6b46'], block: ['#3a2410', '#d9a066', '#8a5a2b', '#5e3c1c'], hz: ['#6bdc2a', '#d4ff8a'] },
  station: { name: 'Station', bg: '#14161f', wall: ['#2a3044', '#7fb2ff', '#3a4a7a'], block: ['#2a2d44', '#c9cce0', '#6b7290', '#4a4f68'], hz: ['#ffe14d', '#1a1a1a'] },
};
function paintGround(g, theme, rand) {
  const T = THEMES[theme] || THEMES.space;
  g.fillStyle = T.bg; g.fillRect(0, 0, BW, BH);
  const dots = (n, cols, alpha = 1) => {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = alpha * (0.35 + rand() * 0.65);
      g.fillStyle = cols[(rand() * rand() * cols.length) | 0];
      g.fillRect((rand() * BW) | 0, (rand() * BH) | 0, 1, 1);
    }
    g.globalAlpha = 1;
  };
  // soft blobs (nebula clouds, ice sheets, moss) via dithered noise
  const blobs = (n, col, rMin, rMax, dens) => {
    for (let i = 0; i < n; i++) {
      const cx = rand() * BW, cy = rand() * BH, r = rMin + rand() * (rMax - rMin);
      g.fillStyle = col;
      for (let y = -r; y < r; y++) for (let x = -r; x < r; x++) {
        const d = Math.hypot(x, y) / r;
        if (d < 1 && rand() < dens * (1 - d * d)) g.fillRect((cx + x) | 0, (cy + y) | 0, 1, 1);
      }
    }
  };
  if (theme === 'space') dots(260, ['#ffffff', '#c9cce0', '#7d82a8', '#4a4e70', '#ff9a5a', '#7fb2ff', '#ff6a6a', '#ffd23f']);
  else if (theme === 'nebula') { blobs(7, '#1c0d3a', 14, 34, 0.9); blobs(6, '#2e1250', 8, 22, 0.7); blobs(4, '#0f2350', 10, 26, 0.6); dots(200, ['#ffffff', '#ffc2f2', '#c77dff', '#7fb2ff']); }
  else if (theme === 'ice') {
    blobs(10, '#1e4560', 10, 30, 0.9); blobs(8, '#27587a', 6, 16, 0.6);
    g.fillStyle = '#4f8db3';
    for (let i = 0; i < 26; i++) { let x = rand() * BW, y = rand() * BH; for (let k = 0; k < 10; k++) { g.fillRect(x | 0, y | 0, 1, 1); x += rand() < 0.5 ? 1 : -1; y += rand() < 0.6 ? 1 : 0; } }
    dots(120, ['#ffffff', '#cdefff'], 0.8);
  } else if (theme === 'lava') {
    blobs(10, '#2a0e08', 8, 24, 0.9); blobs(8, '#3a140a', 4, 12, 0.7);
    for (let i = 0; i < 22; i++) { let x = rand() * BW, y = rand() * BH; g.fillStyle = rand() < 0.5 ? '#6a1a08' : '#a8320c'; for (let k = 0; k < 14; k++) { g.fillRect(x | 0, y | 0, 1, 1); x += rand() < 0.5 ? 1 : 0; y += rand() < 0.5 ? 1 : -1; } }
    dots(60, ['#ff6a1f', '#ffd23f'], 0.6);
  } else if (theme === 'jungle') {
    blobs(12, '#113026', 8, 22, 0.9); blobs(10, '#18452f', 4, 12, 0.8);
    for (let i = 0; i < 70; i++) { const x = (rand() * BW) | 0, y = (rand() * BH) | 0; g.fillStyle = rand() < 0.5 ? '#2a6b3c' : '#3f8a4a'; g.fillRect(x, y, 2, 1); g.fillRect(x + 1, y + 1, 1, 1); }
    dots(50, ['#ffd23f', '#ff9a5a', '#c9ffb0'], 0.5);
  } else if (theme === 'station') {
    g.fillStyle = '#1a1d2a';
    for (let y = 0; y < BH; y += 10) g.fillRect(0, y, BW, 1);
    for (let x = 0; x < BW; x += 10) g.fillRect(x, 0, 1, BH);
    g.fillStyle = '#262a3c';
    for (let y = 0; y < BH; y += 10) for (let x = 0; x < BW; x += 10) { g.fillRect(x + 2, y + 2, 1, 1); g.fillRect(x + 8, y + 8, 1, 1); }
    for (let i = 0; i < 10; i++) { const x = (rand() * (BW / 10) | 0) * 10, y = (rand() * (BH / 10) | 0) * 10; g.fillStyle = '#1f2232'; g.fillRect(x + 1, y + 1, 9, 9); }
  }
}

// ---------------------------------------------------------------- sprite helpers
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function sprite(rows, pal) {
  const h = rows.length, w = rows[0].length, c = makeCanvas(w, h), g = c.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const col = pal[rows[y][x]];
    if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
  }
  return c;
}
// Rasterised (non-antialiased) disc; colorAt(dx, dy, d, r) returns a colour or null.
function disc(r, colorAt) {
  const s = 2 * r + 1, c = makeCanvas(s, s), g = c.getContext('2d');
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = x - r, dy = y - r, d = Math.sqrt(dx * dx + dy * dy);
    if (d > r + 0.3) continue;
    const col = colorAt(dx, dy, d, r);
    if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
  }
  return c;
}
function seeded(seed) { let s = seed | 0 || 1; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

// Ship points "up" in sprite space; drawn rotated by angle + 90°.
// Ship (nose up): softly pointed hull that widens into rounded shoulders, woven pattern,
// white outline and twin engine pods.
const SHIP_ROWS = [
  '.....OOO.....',
  '....OWCWO....',
  '...OWCDCWO...',
  '...OCDCDCO...',
  '..OWCCDCCWO..',
  '..OCDCDCDCO..',
  '.OWCCDCDCCWO.',
  '.OCDCDCDCDCO.',
  'OWCCDCDCDCCWO',
  'OCDCDCDCDCDCO',
  'OCCCCCCCCCCCO',
  '.OWWWOOOWWWO.',
  '.OWWWO.OWWWO.',
  '.OEEEO.OEEEO.',
];
// Pilot's knife, pointing right from the hand: brown grip, silver guard, white blade.
const KNIFE_ROWS = [
  '...G.........',
  'HHHGSSSSSSSW.',
  'HHHGsssssssSW',
  '...G.........',
];
const SLASH_TIME = 0.2;
const CROWN_ROWS = [
  'Y..Y..Y',
  'YY.Y.YY',
  'YYYYYYY',
  'YRYYYRY',
  'YYYYYYY',
];
// bullet capsule pointing right: white body, coloured nose
const BULLET_ROWS = [
  '.oWWWcc.',
  'oWWWWccc',
  'oWWWWccc',
  '.oWWWcc.',
];
// Astronaut, head up (rotated so the head points where the pilot faces):
// white helmet with dark visor, suit in the player's colour, arms, legs, white boots.
const PILOT_ROWS = [
  '...OOO...',
  '..OWWWO..',
  '.OWKKKWO.',
  '.OWKHKWO.',
  '.OWWWWWO.',
  '..OOWOO..',
  'OOCCCCCOO',
  'OWOCCCOWO',
  'OWOCCCOWO',
  'OO.CCC.OO',
  '..OCOCO..',
  '..OCOCO..',
  '..OWOWO..',
  '..OOOOO..',
];
const CRATE_ROWS = [
  '.LLLLLLLLL.',
  'LCCCCCCCCCL',
  'LCHHCCCCCCL',
  'LCHCCCCCCCL',
  'LCCKCCCKCCL',
  'LCCKCCCKCCL',
  'LCCCCCCCCCL',
  'LCCCKKKCCCL',
  'LCCCCCCCCCL',
  'LDDDDDDDDDL',
  '.LLLLLLLLL.',
];
const MINE_ROWS = [
  '.#.....#.',
  '..#.#.#..',
  '...###...',
  '.#######.',
  '..##.##..',
  '.#######.',
  '...###...',
  '..#.#.#..',
  '.#.....#.',
];
const BLOCK_ROWS = [
  'oooooooooo',
  'ohhhhhhhho',
  'ohmmmmmmso',
  'ohmmcmmmso',
  'ohmmmcmmso',
  'ohmmmmcmso',
  'ohmmmmmmso',
  'ohmcmmmmso',
  'osssssssso',
  'oooooooooo',
];
// 5×5 glyphs so every powerup reads at a glance.
const GLYPHS = {
  laser: ['.....', '#....', '#####', '#....', '.....'],
  triple: ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
  bounce: ['#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
  homing: ['.###.', '#...#', '#.#.#', '#...#', '.###.'],
  mine: ['#.#.#', '.###.', '##.##', '.###.', '#.#.#'],
  freeze: ['..#..', '#.#.#', '.###.', '#.#.#', '..#..'],
  shield: ['#####', '#...#', '#...#', '.#.#.', '..#..'],
  joust: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  reverse: ['.###.', '#...#', '#.#..', '#..#.', '.##..'],
};

class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.buf = makeCanvas(BW, BH);
    this.b = this.buf.getContext('2d');
    this.b.imageSmoothingEnabled = false;
    this.parts = [];
    this.shake = 0; this.punch = 0;
    this.time = 0;
    this.cache = new Map();
    this.bumpT = {};
    this.suddenAt = -99;
    this.banner = null;
    this.lastCount = -1;
    this.cam = { x: SP.W / 2, y: SP.H / 2, z: 1 };
    this.view = { x: SP.W / 2, y: SP.H / 2, z: 1, hw: SP.W / 2, hh: SP.H / 2 };
    this.trails = new Map();
    this.layerKey = '';
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.cv.width = Math.round(w * this.dpr); this.cv.height = Math.round(h * this.dpr);
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    let top = 0;
    if (this.hud) {
      const side = (w - h * SP.W / SP.H) / 2 >= 104;
      document.body.dataset.hud = side ? 'side' : 'top';
      if (!side) top = 42;
    } else delete document.body.dataset.hud;
    this.scale = Math.min(w / SP.W, (h - top) / SP.H);
    this.ox = (w - SP.W * this.scale) / 2; this.oy = top + (h - top - SP.H * this.scale) / 2;
  }
  setHud(on) { this.hud = on; this.resize(); }

  get(key, make) { let c = this.cache.get(key); if (!c) { c = make(); this.cache.set(key, c); } return c; }
  shipSprite(color) {
    return this.get('ship' + color, () => sprite(SHIP_ROWS, { W: '#ffffff', C: color, D: shade(color, -0.35), E: '#ff7a1a', O: '#14142a' }));
  }
  pilotSprite(color) {
    return this.get('pilot' + color, () => sprite(PILOT_ROWS, { W: '#ffffff', C: color, K: '#14142a', H: '#7fe9ff', O: '#14142a' }));
  }
  itemSprite(type) {
    return this.get('item' + type, () => {
      const col = SP.POWERS[type].color;
      const c = disc(6, (dx, dy, d) => d > 4.6 ? col : d > 3.9 ? shade(col, -0.5) : '#10132a');
      const g = c.getContext('2d'), gl = GLYPHS[type];
      g.fillStyle = '#ffffff';
      for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (gl[y][x] === '#') g.fillRect(4 + x, 4 + y, 1, 1);
      return c;
    });
  }
  glyphSprite(type, color) {
    return this.get('glyph' + type + color, () => sprite(GLYPHS[type], { '#': color }));
  }

  // ------------------------------------------------------------ static map layer
  wallRect(g, x0, y0, x1, y1, theme) {
    const w = x1 - x0, h = y1 - y0, P = (THEMES[theme || this.theme] || THEMES.space).wall;
    g.fillStyle = P[0]; g.fillRect(x0, y0, w, h);
    g.fillStyle = P[1];
    g.fillRect(x0, y0, w, 1); g.fillRect(x0, y1 - 1, w, 1); g.fillRect(x0, y0, 1, h); g.fillRect(x1 - 1, y0, 1, h);
    if (w > 4 && h > 4) {
      g.fillStyle = P[2];
      g.fillRect(x0 + 2, y0 + 2, w - 4, 1); g.fillRect(x0 + 2, y1 - 3, w - 4, 1); g.fillRect(x0 + 2, y0 + 2, 1, h - 4); g.fillRect(x1 - 3, y0 + 2, 1, h - 4);
    }
  }
  layer(map) {
    if (this.layerKey === map.id) return this.layerCanvas;
    this.layerKey = map.id;
    this.trails.clear();
    this.theme = map.theme || 'space';
    const T = THEMES[this.theme] || THEMES.space;
    const c = makeCanvas(BW, BH), g = c.getContext('2d');
    let seed = 7; for (const ch of map.id) seed = seed * 31 + ch.charCodeAt(0);
    paintGround(g, this.theme, seeded(seed));
    const X = v => Math.round(v / PX);
    for (const w of map.walls) this.wallRect(g, X(w[0]), X(w[1]), X(w[0] + w[2]), X(w[1] + w[3]));
    // arena border
    g.fillStyle = T.wall[1]; g.fillRect(0, 0, BW, 1); g.fillRect(0, BH - 1, BW, 1); g.fillRect(0, 0, 1, BH); g.fillRect(BW - 1, 0, 1, BH);
    g.fillStyle = T.wall[2]; g.fillRect(2, 2, BW - 4, 1); g.fillRect(2, BH - 3, BW - 4, 1); g.fillRect(2, 2, 1, BH - 4); g.fillRect(BW - 3, 2, 1, BH - 4);
    this.layerCanvas = c;
    return c;
  }
  hubSprite(r) {
    const P = (THEMES[this.theme] || THEMES.space).wall;
    return this.get('hub' + r + this.theme, () => disc(Math.round(r / PX), (dx, dy, dd, R) => dd > R - 1 ? P[1] : dd > R - 3 && dd <= R - 2 ? P[2] : P[0]));
  }

  // ------------------------------------------------------------ particles (world units)
  add(p) {
    if (this.parts.length >= MAX_PARTS) return;
    if (p.vx === undefined) { p.vx = 0; p.vy = 0; }
    this.parts.push(p);
  }
  burst(x, y, color, n, speed, life, size = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * SP.TAU, s = speed * (0.2 + Math.random());
      this.add({ k: 'px', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.4 + Math.random() * 0.8), max: life, c: color, size: Math.random() < 0.3 ? size + 1 : size });
    }
  }
  ring(x, y, color, r0, r1, life) { this.add({ k: 'ring', x, y, r0, r1, life, max: life, c: color }); }
  text(x, y, str, color, size = 12, life = 1.1) { this.add({ k: 'text', x, y, vx: 0, vy: -0.6, life, max: life, c: color, s: str, size }); }
  bump(amount) { if (!this.silent) this.shake = Math.max(this.shake, amount); }
  // directional camera kick (recoils away from an impact)
  kick(a, amount) { if (this.silent) return; this.kickX = (this.kickX || 0) + Math.cos(a) * amount; this.kickY = (this.kickY || 0) + Math.sin(a) * amount; }
  zoomPunch(amount) { if (!this.silent) this.punch = Math.max(this.punch, amount); }
  snd(name) { if (!this.silent) Sfx.play(name); }
  explosion(x, y, color, big) {
    const n = big ? 1 : 0.6;
    this.burst(x, y, color, 34 * n | 0, 6, 0.9);
    this.burst(x, y, '#ffffff', 16 * n | 0, 8, 0.4);
    this.burst(x, y, '#ffd23f', 18 * n | 0, 5, 0.7);
    this.burst(x, y, '#ff6a1f', 14 * n | 0, 4, 0.8, 2);
    for (let i = 0; i < 6 * n; i++) this.add({ k: 'smoke', x: x + (Math.random() - 0.5) * 20, y: y + (Math.random() - 0.5) * 20, vx: (Math.random() - 0.5) * 1.2, vy: (Math.random() - 0.5) * 1.2, life: 1, max: 1, size: 2 + (Math.random() * 3 | 0) });
    this.add({ k: 'flash', x, y, life: 0.12, max: 0.12, r: big ? 12 : 8 });
  }

  fx(e, fr, mine) {
    const ship = e.id != null ? fr.sh.find(s => s.id === e.id) : null;
    const col = e.c || (ship && ship.c) || '#ffffff';
    switch (e.e) {
      case 'shot':
        if (ship) {
          const ca = Math.cos(ship.a), sa = Math.sin(ship.a);
          this.burst(ship.x + ca * 20, ship.y + sa * 20, '#ffffff', 3, 2.5, 0.12);
          this.add({ k: 'flash', x: ship.x + ca * 20, y: ship.y + sa * 20, life: 0.06, max: 0.06, r: 2 });
        }
        this.snd(e.k === 't' ? 'triple' : e.k === 'm' ? 'missile' : e.k === 'i' ? 'ice' : 'shot');
        break;
      case 'dry':
        if (ship) this.add({ k: 'smoke', x: ship.x + Math.cos(ship.a) * 18, y: ship.y + Math.sin(ship.a) * 18, vx: Math.cos(ship.a), vy: Math.sin(ship.a), life: 0.3, max: 0.3, size: 2 });
        if (mine) this.snd('dry');
        break;
      case 'use': {
        const P = SP.POWERS[e.t];
        if (ship && P) this.text(ship.x, ship.y - 44, P.name + '!', P.color, 12, 0.9);
        if (e.t === 'joust') this.snd('joustOn');
        else if (e.t !== 'laser' && e.t !== 'mine') this.snd('activate');
        break;
      }
      case 'wall':
        this.burst(e.x, e.y, '#ffb37a', 6, 2.5, 0.3);
        this.snd('wall');
        if (mine) this.bump(Math.min(6, e.k));
        break;
      case 'melee':
        // knife swing: animated in drawSlashes, follows the pilot
        (this.slashes = this.slashes || []).push({ id: e.id, a: e.a, t: this.time, x: e.x, y: e.y, side: (this.slashSide = -(this.slashSide || 1)) });
        this.snd('punch');
        break;
      case 'kill':
        this.feed(e.by, e.id, fr, false);
        this.killCam(e.x, e.y, 0.35);
        this.explosion(e.x, e.y, col, true);
        for (let i = 0; i < 6; i++) { const a = Math.random() * SP.TAU, s = 1 + Math.random() * 2.5; this.add({ k: 'shard', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1.3, max: 1.3, c: i % 2 ? '#ffffff' : col, size: 2 }); }
        this.ring(e.x, e.y, '#ffffff', 8, 70, 0.3);
        this.bump(mine ? 26 : 16); this.zoomPunch(0.07);
        this.snd('kill');
        if (mine && !this.silent && navigator.vibrate) navigator.vibrate(120);
        break;
      case 'elim':
        this.feed(e.by, e.id, fr, true);
        this.killCam(e.x, e.y, 0.5);
        this.burst(e.x, e.y, col, 22, 4, 0.7);
        this.burst(e.x, e.y, '#ff4766', 10, 3, 0.6);
        this.ring(e.x, e.y, col, 4, 45, 0.3);
        this.text(e.x, e.y - 22, 'X', col, 14);
        this.bump(mine ? 18 : 10); this.zoomPunch(0.04);
        this.snd('elim');
        if (mine && !this.silent && navigator.vibrate) navigator.vibrate([60, 40, 160]);
        break;
      case 'boom': {
        const big = e.s === 'mine';
        this.add({ k: 'fireball', x: e.x, y: e.y, R: e.r * (big ? 1 : 0.85), life: big ? 0.55 : 0.4, max: big ? 0.55 : 0.4 });
        this.add({ k: 'shock', x: e.x, y: e.y, r0: 6, r1: e.r * 1.5, life: 0.28, max: 0.28 });
        this.add({ k: 'scorch', x: e.x, y: e.y, R: e.r * 0.55, life: 4, max: 4 });
        this.explosion(e.x, e.y, '#ff6a1f', true);
        for (let i = 0; i < (big ? 10 : 6); i++) { const a = Math.random() * SP.TAU, sp = 2 + Math.random() * 4; this.add({ k: 'shard', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.9, max: 0.9, c: i % 3 ? '#5a5a70' : '#ffd23f', size: 2 }); }
        for (let i = 0; i < (big ? 10 : 6); i++) this.add({ k: 'smoke', x: e.x + (Math.random() - 0.5) * e.r, y: e.y + (Math.random() - 0.5) * e.r, vx: (Math.random() - 0.5) * 0.8, vy: -0.4 - Math.random() * 0.8, life: 1.6, max: 1.6, size: 3 + (Math.random() * 3 | 0) });
        this.bump(big ? 30 : 20); this.zoomPunch(big ? 0.1 : 0.06);
        this.snd('boom');
        break;
      }
      case 'hit': {
        // impact: white star flash at the contact point, sparks thrown along the bullet's path, camera recoil
        this.add({ k: 'impact', x: e.x, y: e.y, life: 0.12, max: 0.12 });
        for (let i = 0; i < 10; i++) { const a = e.a + (Math.random() - 0.5) * 1.4, sp = 2 + Math.random() * 5; this.add({ k: 'px', x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3, max: 0.3, c: i % 2 ? '#ffffff' : (e.c || '#ffd23f'), size: 1 }); }
        this.ring(e.x, e.y, '#ffffff', 4, 30, 0.15);
        this.kick(e.a, mine ? 10 : 5);
        this.bump(mine ? 10 : 5);
        break;
      }
      case 'block': this.burst(e.x, e.y, '#a5a5b8', 12, 3, 0.7, 2); this.burst(e.x, e.y, '#55556a', 8, 2, 0.6); this.snd('block'); break;
      case 'rock': this.burst(e.x, e.y, '#9aa0bc', 10 + (e.r / 3 | 0), 3, 0.8, 2); this.snd('block'); break;
      case 'crate': if (e.t && SP.POWERS[e.t]) this.text(e.x, e.y - 28, SP.POWERS[e.t].name, SP.POWERS[e.t].color, 10, 0.8);
        this.burst(e.x, e.y, '#ff7a1a', 16, 4, 0.6); this.burst(e.x, e.y, '#ffd23f', 8, 3, 0.4); this.ring(e.x, e.y, '#ffb347', 6, 36, 0.25); this.snd('crate'); break;
      case 'crateIn': this.ring(e.x, e.y, '#ffd23f', 36, 6, 0.4); break;
      case 'pick': {
        const P = SP.POWERS[e.t];
        this.ring(e.x, e.y, P.color, 8, 42, 0.3);
        this.burst(e.x, e.y, P.color, 12, 3, 0.4);
        if (e.t === 'shield') { this.text(e.x, e.y - 30, 'SHIELD UP!', P.color, 12); this.snd('shieldOn'); }
        else if (e.t !== 'reverse') { this.text(e.x, e.y - 30, P.name, P.color, 10); this.snd('pick'); }
        break;
      }
      case 'reverse': {
        const p = fr.pl.find(q => q.id === e.id);
        this.banner = { text: 'REVERSE ALL!', sub: (p ? p.n : 'Someone') + ' spun everyone around', color: SP.POWERS.reverse.color, t: this.time };
        for (const s of fr.sh) if (s.m !== 'd' && s.id !== e.id) { this.ring(s.x, s.y, SP.POWERS.reverse.color, 50, 8, 0.5); this.burst(s.x, s.y, SP.POWERS.reverse.color, 14, 4, 0.5); }
        this.bump(10); this.zoomPunch(0.08);
        this.snd('reverse');
        break;
      }
      case 'spark': this.burst(e.x, e.y, col, 5, 2, 0.2); break;
      case 'smash': this.burst(e.x, e.y, '#ffd23f', 8, 4, 0.3); this.bump(4); break;
      case 'hazard': { const hz = (THEMES[this.theme] || THEMES.space).hz; this.burst(e.x, e.y, hz[0], 18, 4, 0.7, 2); this.burst(e.x, e.y, hz[1], 10, 3, 0.5); this.snd('sizzle'); break; }
      case 'zap': this.burst(e.x, e.y, '#ff2a4a', 16, 4, 0.6, 2); this.burst(e.x, e.y, '#ffd23f', 8, 3, 0.4); this.snd('sizzle'); break;
      case 'ric': this.burst(e.x, e.y, '#4dff88', 5, 2.5, 0.2); this.snd('ric'); break;
      case 'bump': {
        let bi = 0, bd = 1e9;
        fr.map.bumpers.forEach((b, i) => { const d = Math.hypot(b.x - e.x, b.y - e.y); if (d < bd) { bd = d; bi = i; } });
        this.bumpT[bi] = this.time;
        if (!e.q) { this.snd('bump'); this.burst(e.x, e.y, '#ff4dd8', 6, 3, 0.25); }
        break;
      }
      case 'bonk': this.burst(e.x, e.y, '#ffffff', 4, 2, 0.2); this.snd('bonk'); break;
      case 'freeze': this.burst(e.x, e.y, '#bff6ff', 16, 3, 0.5); this.text(e.x, e.y - 30, 'FROZEN!', '#7fe9ff', 10); this.snd('freeze'); break;
      case 'shatter': this.burst(e.x, e.y, '#bff6ff', 26, 5, 0.8, 2); this.bump(8); this.snd('shatter'); break;
      case 'shieldPop': this.ring(e.x, e.y, '#3fa9ff', 20, 55, 0.3); this.burst(e.x, e.y, '#9fd4ff', 14, 4, 0.4); this.snd('shield'); break;
      case 'clang': this.burst(e.x, e.y, '#ffffff', 8, 4, 0.2); this.snd('clang'); break;
      case 'bladeBreak': this.burst(e.x, e.y, '#4dff88', 14, 4, 0.5, 2); this.burst(e.x, e.y, '#ffffff', 6, 3, 0.3); this.snd('shatter'); this.text(e.x, e.y - 20, 'BLADE BROKEN', '#4dff88', 8, 0.7); break;
      case 'beep': this.snd('beep'); break;
      case 'drop': this.snd('drop'); break;
      case 'dash':
        if (ship) this.burst(ship.x - Math.cos(ship.a) * 12, ship.y - Math.sin(ship.a) * 12, '#ffffff', 8, 2, 0.3);
        this.snd('dash');
        break;
      case 'charge': this.snd('charge'); break;
      case 'laser': this.bump(9); this.snd('laser'); break;
      case 'respawn': this.ring(e.x, e.y, col, 50, 8, 0.4); this.burst(e.x, e.y, '#ffffff', 10, 3, 0.4); this.snd('respawn'); break;
      case 'sizzle': this.burst(e.x, e.y, '#ffb347', 5, 2, 0.3); this.snd('sizzle'); break;
      case 'go': this.snd('go'); break;
      case 'round': this.trails.clear(); this.banner = null; this.feedList = []; this.kc = null; this.slashes = []; break;
      case 'sudden': this.suddenAt = this.time; this.snd('sudden'); break;
      case 'roundWin': this.snd(e.id ? 'roundWin' : 'lose'); break;
      case 'point': {
        const s = fr.sh.find(q => q.id === e.id);
        if (s) this.text(s.x, s.y - 30, e.d > 0 ? '+1' : '-1', e.d > 0 ? '#ffffff' : '#ff4766', 14);
        if (e.d > 0) this.snd('point');
        break;
      }
      case 'matchWin': {
        this.snd('matchWin');
        const p = fr.pl.find(q => q.id === e.id);
        for (let i = 0; i < 140; i++) {
          this.add({ k: 'confetti', x: Math.random() * SP.W, y: -20 - Math.random() * 300, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3, life: 5, max: 5, c: Math.random() < 0.5 && p ? p.c : SP.COLORS[(Math.random() * 6) | 0], size: 6 + (Math.random() * 6 | 0), screen: true, rot: Math.random() * 6 });
        }
        break;
      }
    }
  }

  // Kill feed entry: who got whom, shown for 2 seconds.
  feed(by, id, fr, final) {
    if (this.silent) return;
    const v = fr.pl.find(p => p.id === id); if (!v) return;
    const k = by && by !== 'env' && by !== id ? fr.pl.find(p => p.id === by) : null;
    this.feedList = (this.feedList || []).filter(f => this.time - f.t < 2);
    this.feedList.push({ t: this.time, k: k ? k.n : (by === 'env' ? 'ARENA' : by === id ? '' : '?'), kc: k ? k.c : '#9a9ab0', v: v.n, vc: v.c, final, self: by === id });
    if (this.feedList.length > 4) this.feedList.shift();
  }
  // Kill cam: brief slow motion, a push toward the kill and light shafts across the screen.
  killCam(x, y, dur) {
    if (this.silent) return;
    this.kc = { t: this.time, x, y, dur };
  }
  // Time scale requested by the kill cam (used by local play to slow the simulation).
  timeScale() { return 1; } // kill cam is visual only — never slow the game down
  drawFeed(g) {
    if (!this.feedList || !this.feedList.length) return;
    let y = this.oy + 18;
    for (const f of this.feedList) {
      const age = this.time - f.t; if (age > 2) continue;
      const a = Math.min(1, (2 - age) * 3), cx = this.ox + SP.W * this.scale / 2;
      g.font = `10px ${FONT}`;
      const left = f.self ? '' : f.k, mid = f.self ? ' SELF-DESTRUCT ' : f.final ? ' X ' : ' > ', right = f.v;
      const wl = g.measureText(left).width, wm = g.measureText(mid).width, wr = g.measureText(right).width, tot = wl + wm + wr;
      g.globalAlpha = a * 0.7; g.fillStyle = '#000000'; g.fillRect(Math.round(cx - tot / 2 - 8), y - 9, Math.round(tot + 16), 18); g.globalAlpha = 1;
      this.pixText(g, left, cx - tot / 2, y, 10, f.kc, a, 'left');
      this.pixText(g, mid, cx - tot / 2 + wl, y, 10, f.final ? '#ff4766' : '#ffffff', a, 'left');
      this.pixText(g, right, cx - tot / 2 + wl + wm, y, 10, f.vc, a, 'left');
      y += 22;
    }
  }
  drawKillCam(g) {
    if (!this.kc) return;
    const age = this.time - this.kc.t, life = this.kc.dur + 0.35;
    if (age > life) { this.kc = null; return; }
    const a = Math.min(1, (life - age) * 3) * 0.08, vw = SP.W * this.scale, vh = SP.H * this.scale;
    g.save();
    g.beginPath(); g.rect(this.ox, this.oy, vw, vh); g.clip();
    g.globalAlpha = a; g.fillStyle = '#ffffff';
    const slant = vh * 0.6, shift = age * 260;
    for (const [off, w] of [[0.15, 0.08], [0.38, 0.14], [0.66, 0.06], [0.82, 0.1]]) {
      const x0 = this.ox + off * vw - shift + vw * 0.2;
      g.beginPath(); g.moveTo(x0, this.oy); g.lineTo(x0 + w * vw, this.oy); g.lineTo(x0 + w * vw - slant, this.oy + vh); g.lineTo(x0 - slant, this.oy + vh); g.closePath(); g.fill();
    }
    // dark edges for drama
    g.globalAlpha = a * 1.6; g.fillStyle = '#000000';
    g.fillRect(this.ox, this.oy, vw, 18); g.fillRect(this.ox, this.oy + vh - 18, vw, 18);
    g.restore();
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------ camera
  updateCamera(fr, dt) {
    const W = SP.W, H = SP.H, cam = this.cam;
    let tx = W / 2, ty = H / 2, tz = 1;
    const live = fr.ph === 'play' || fr.ph === 'roundEnd' || (fr.ph === 'countdown' && fr.pt > 70);
    if (live) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0;
      const focus = fr.ph === 'roundEnd' && fr.rw ? fr.sh.find(s => s.id === fr.rw && s.m !== 'd') : null;
      for (const s of fr.sh) {
        if (s.m === 'd' || (focus && s !== focus)) continue;
        if (s.x < x0) x0 = s.x; if (s.x > x1) x1 = s.x; if (s.y < y0) y0 = s.y; if (s.y > y1) y1 = s.y; n++;
      }
      if (n) {
        const pad = focus ? 220 : 190;
        const bw = Math.max(x1 - x0 + pad * 2, W / 1.8), bh = Math.max(y1 - y0 + pad * 2, H / 1.8);
        tz = Math.min(1.8, Math.max(1, Math.min(W / bw, H / bh)));
        tx = (x0 + x1) / 2; ty = (y0 + y1) / 2;
      }
    }
    const kz = 1 - Math.exp(-dt * (tz < cam.z ? 5 : 1.6));
    const kp = 1 - Math.exp(-dt * 3.5);
    cam.z += (tz - cam.z) * kz;
    cam.x += (tx - cam.x) * kp; cam.y += (ty - cam.y) * kp;
    this.punch *= Math.pow(0.004, dt);
    const z = cam.z * (1 + this.punch);
    const hw = W / (2 * z), hh = H / (2 * z);
    this.view = { z, x: Math.min(W - hw, Math.max(hw, cam.x)), y: Math.min(H - hh, Math.max(hh, cam.y)), hw, hh };
  }
  // world → CSS pixels on screen
  sx(x) { const v = this.view; return this.ox + SP.W * this.scale / 2 + (x - v.x) * this.scale * v.z; }
  sy(y) { const v = this.view; return this.oy + SP.H * this.scale / 2 + (y - v.y) * this.scale * v.z; }

  // ------------------------------------------------------------ main draw
  draw(fr, dt, opts = {}) {
    this.time += dt;
    const g = this.ctx, d = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = '#000000'; g.fillRect(0, 0, this.cv.width, this.cv.height);
    if (!fr) return;
    this.updateCamera(fr, dt);
    this.shake *= Math.pow(0.006, dt);
    if (this.shake < 0.4) this.shake = 0;
    this.kickX *= Math.pow(0.0004, dt); this.kickY *= Math.pow(0.0004, dt);

    // 1) world into the low-res buffer
    const b = this.b;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalAlpha = 1;
    b.drawImage(this.layer(fr.map), 0, 0);
    this.drawMap(b, fr);
    this.drawScorches(b);
    this.drawShrink(b, fr, this.time);
    this.drawPickups(b, fr);
    this.updateTrails(fr);
    this.drawTrails(b, fr);
    this.drawBullets(b, fr);
    for (const s of fr.sh) if (s.m !== 'd') this.drawBeam(b, s);
    for (const s of fr.sh) if (s.m === 'p') this.drawPilot(b, s, fr);
    for (const s of fr.sh) if (s.m === 's') this.drawShip(b, s);
    this.drawSlashes(b, fr);
    this.drawCrown(b, fr);
    this.stepParticles(b, dt);

    // 2) scale the visible part of the buffer up to the screen with hard pixel edges
    const v = this.view;
    const shx = (Math.random() - 0.5) * this.shake + (this.kickX || 0), shy = (Math.random() - 0.5) * this.shake + (this.kickY || 0);
    const srcW = 2 * v.hw / PX, srcH = 2 * v.hh / PX;
    const srcX = Math.max(0, Math.min(BW - srcW, (v.x - v.hw + shx) / PX)), srcY = Math.max(0, Math.min(BH - srcH, (v.y - v.hh + shy) / PX));
    g.imageSmoothingEnabled = false;
    g.drawImage(this.buf, srcX, srcY, srcW, srcH, this.ox * d, this.oy * d, SP.W * this.scale * d, SP.H * this.scale * d);

    // 3) crisp text on top
    g.setTransform(d, 0, 0, d, 0, 0);
    this.drawKillCam(g);
    this.drawLabels(g, fr, opts);
    this.drawTexts(g, dt);
    this.drawFeed(g);
    const meShip = opts.me ? fr.sh.find(q => q.id === opts.me) : null;
    if ((meShip && meShip.rv > 0) || (opts.localRev && fr.sh.some(q => q.rv > 0 && opts.localRev.has(q.id)))) {
      const vw = SP.W * this.scale, vh = SP.H * this.scale, a = 0.35 + Math.sin(this.time * 10) * 0.15, e = 10;
      g.globalAlpha = a; g.fillStyle = SP.POWERS.reverse.color;
      g.fillRect(this.ox, this.oy, vw, e); g.fillRect(this.ox, this.oy + vh - e, vw, e); g.fillRect(this.ox, this.oy, e, vh); g.fillRect(this.ox + vw - e, this.oy, e, vh);
      g.globalAlpha = 1;
      if (meShip && meShip.rv > 0) this.pixText(g, 'CONTROLS REVERSED ' + Math.ceil(meShip.rv / 60), this.ox + vw / 2, this.oy + vh - 26, 10, SP.POWERS.reverse.color, 0.9);
    }
    g.setTransform(this.scale * d, 0, 0, this.scale * d, this.ox * d, this.oy * d);
    this.drawConfetti(g, dt);
    this.drawOverlay(g, fr, opts);
  }

  drawMap(b, fr) {
    const map = fr.map, t = this.time, X = v => Math.round(v / PX);
    const theme = this.theme, BP = (THEMES[theme] || THEMES.space).block;
    for (let i = 0; i < map.blocks.length; i++) if (fr.bk.charCodeAt(i) === 49) {
      const k = map.blocks[i], w = X(k[0] + k[2]) - X(k[0]), h = X(k[1] + k[3]) - X(k[1]);
      b.drawImage(this.get('blk' + theme + w + 'x' + h, () => blockSprite(w, h, BP, theme)), X(k[0]), X(k[1]));
    }
    this.drawHazards(b, map, t);
    if (map.sun) {
      const S = map.sun, R = Math.round(S.r / PX);
      const spr = this.get('sun' + R, () => disc(R, (dx, dy, dd, r) => {
        const q = dd / r + (((dx + dy) & 1) ? 0.04 : -0.04);
        if (dx + dy < -r * 0.9 && dd > r * 0.55) return '#fff7c8';
        return q < 0.45 ? '#fff3b0' : q < 0.72 ? '#ffd23f' : q < 0.9 ? '#ff9a2e' : '#ff6a1f';
      }));
      b.drawImage(spr, X(S.x) - R, X(S.y) - R);
      for (let i = 0; i < 26; i++) {
        const a = i / 26 * SP.TAU + t * 0.6, rr = R + 2 + ((Math.sin(t * 6 + i * 2.7) + 1) * 2.2 | 0);
        b.fillStyle = i % 3 ? '#ff9a2e' : '#ffd23f';
        b.fillRect(Math.round(X(S.x) + Math.cos(a) * rr), Math.round(X(S.y) + Math.sin(a) * rr), 1, 1);
      }
      b.fillStyle = 'rgba(255,106,31,0.35)';
      const gr = R * 3 + ((t * 8) % (R * 2));
      for (let i = 0; i < 60; i += 2) { const a = i / 60 * SP.TAU; b.fillRect(Math.round(X(S.x) + Math.cos(a) * gr), Math.round(X(S.y) + Math.sin(a) * gr), 1, 1); }
    }
    for (const sp of map.spinners) {
      const L = Math.round(sp.len / PX), T = Math.max(3, Math.round(sp.th / PX));
      const bar = this.get('bar' + L + 'x' + T + this.theme, () => { const c = makeCanvas(L, T); this.wallRect(c.getContext('2d'), 0, 0, L, T); return c; });
      for (let k = 0; k < sp.arms; k++) {
        const th = sp.a0 + sp.speed * fr.t + k * Math.PI / sp.arms;
        b.save(); b.translate(X(sp.x), X(sp.y)); b.rotate(th); b.drawImage(bar, -L / 2, -T / 2); b.restore();
      }
    }
    for (const ci of map.circles) { const hub = this.hubSprite(ci.r); b.drawImage(hub, X(ci.x) - (hub.width >> 1), X(ci.y) - (hub.height >> 1)); }
    map.bumpers.forEach((bp, i) => {
      const lit = this.time - (this.bumpT[i] ?? -9) < 0.15;
      const R = Math.round(bp.r / PX) + (lit ? 1 : 0);
      const spr = this.get('bump' + R + lit, () => disc(R, (dx, dy, dd, r) => dd > r - 1.2 ? '#ff4dd8' : dd > r - 2.2 ? '#7a1f6e' : lit ? '#ffb3f0' : (dd < r * 0.45 && dd > r * 0.45 - 1.2) ? '#ff4dd8' : '#1e0a22'));
      b.drawImage(spr, X(bp.x) - R, X(bp.y) - R);
    });
    for (const a of fr.as) {
      const R = Math.round(a.r / PX);
      const spr = this.get('rock' + a.id + '_' + R, () => {
        const rnd = seeded(a.id * 977 + R), craters = [], bumps = [];
        for (let i = 0; i < 3; i++) craters.push([(rnd() - 0.5) * R, (rnd() - 0.5) * R, 1 + rnd() * R * 0.3]);
        for (let i = 0; i < 8; i++) bumps.push(rnd());
        return disc(R, (dx, dy, dd, r) => {
          const ang = Math.min(7, Math.floor((Math.atan2(dy, dx) + Math.PI) / SP.TAU * 8));
          const edge = r - bumps[ang] * 1.6;
          if (dd > edge) return null;
          if (dd > edge - 1) return '#ffffff';
          for (const c of craters) if (Math.hypot(dx - c[0], dy - c[1]) < c[2]) return '#6a6a78';
          return dx + dy < -r * 0.5 ? '#c8c8d4' : '#9a9aa8';
        });
      });
      b.save(); b.translate(X(a.x), X(a.y)); b.rotate(a.a); b.drawImage(spr, -R, -R); b.restore();
    }
  }

  // Animated hazard pools: lava bubbles, water ripples, acid, electric floor.
  drawHazards(b, map, t) {
    if (!map.hazards.length) return;
    const [base, hi] = (THEMES[this.theme] || THEMES.space).hz, X = v => Math.round(v / PX);
    for (const h of map.hazards) {
      const x0 = X(h[0]), y0 = X(h[1]), w = X(h[0] + h[2]) - x0, hh = X(h[1] + h[3]) - y0;
      b.fillStyle = base; b.fillRect(x0, y0, w, hh);
      if (this.theme === 'station') {
        b.fillStyle = hi;
        for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (((x + y + Math.floor(t * 8)) & 3) < 2) b.fillRect(x0 + x, y0 + y, 1, 1);
        continue;
      }
      b.fillStyle = hi;
      const n = Math.max(2, (w * hh) / 18 | 0), step = Math.floor(t * 6);
      for (let i = 0; i < n; i++) {
        const r = Math.sin(i * 12.9898 + step * 78.233 + x0) * 43758.5453, f = r - Math.floor(r);
        const r2 = Math.sin(i * 39.3468 + step * 11.135 + y0) * 24634.6345, f2 = r2 - Math.floor(r2);
        b.fillRect(x0 + (f * w | 0), y0 + (f2 * hh | 0), 1 + (i % 3 === 0 ? 1 : 0), 1);
      }
      // glowing rim
      b.globalAlpha = 0.5 + Math.sin(t * 4) * 0.2;
      b.fillRect(x0, y0, w, 1); b.fillRect(x0, y0 + hh - 1, w, 1); b.fillRect(x0, y0, 1, hh); b.fillRect(x0 + w - 1, y0, 1, hh);
      b.globalAlpha = 1;
    }
  }

  // Sudden death: the arena edge closes in as a deadly red border.
  drawShrink(b, fr, t) {
    if (!(fr.sk > 0)) return;
    const mx = Math.round(fr.sk / PX), my = Math.round(fr.sk * SP.H / SP.W / PX);
    b.globalAlpha = 0.55;
    b.fillStyle = '#3a0008';
    b.fillRect(0, 0, BW, my); b.fillRect(0, BH - my, BW, my); b.fillRect(0, my, mx, BH - 2 * my); b.fillRect(BW - mx, my, mx, BH - 2 * my);
    b.globalAlpha = 1;
    b.fillStyle = Math.floor(t * 6) % 2 ? '#ff2a4a' : '#ffd23f';
    const off = Math.floor(t * 10);
    for (let x = mx; x < BW - mx; x++) if (((x + off) >> 1) % 2) { b.fillRect(x, my, 1, 1); b.fillRect(x, BH - my - 1, 1, 1); }
    for (let y = my; y < BH - my; y++) if (((y + off) >> 1) % 2) { b.fillRect(mx, y, 1, 1); b.fillRect(BW - mx - 1, y, 1, 1); }
  }

  drawPickups(b, fr) {
    const t = this.time, X = v => Math.round(v / PX);
    const orb = this.get('orb', () => disc(6, (dx, dy, d, r) => {
      if (d > r - 0.9) return '#7a1f0a';
      const h = Math.sin(dx * 12.9898 + dy * 78.233) * 43758.5453, f = h - Math.floor(h);
      if (dx + dy < -4 && d > r - 2.5) return '#ffb347';
      return f < 0.16 ? '#ffd23f' : f < 0.32 ? '#c2410c' : '#ff7a1a';
    }));
    for (const c of fr.cr) b.drawImage(orb, X(c.x) - 6, X(c.y) - 6 + (Math.sin(t * 3 + c.id) > 0.6 ? -1 : 0));
    for (const it of fr.it) {
      if (it.l < 180 && Math.floor(t * 8) % 2) continue;
      if (it.w > 0) { b.fillStyle = '#ffffff'; b.globalAlpha = it.w / 24; this.pring(b, X(it.x), X(it.y), 9 - Math.round(it.w / 6)); b.globalAlpha = 1; }
      b.drawImage(this.itemSprite(it.t), X(it.x) - 6, X(it.y) - 6 + (Math.sin(t * 4 + it.id) > 0 ? -1 : 0));
    }
    for (const m of fr.mi) {
      const armed = m.ar <= 0;
      const spr = this.get('mine' + m.c, () => sprite(MINE_ROWS, { '#': m.c }));
      const mx = X(m.x), my = X(m.y);
      if (m.fu > 0) {
        // triggered: blast zone appears, mine spins up faster and faster, light strobes, then boom
        const k = 1 - m.fu / SP.C.MINE_FUSE, R = Math.round(SP.C.MINE_BLAST / PX);
        b.globalAlpha = 0.12 + 0.18 * k; b.fillStyle = '#ff2a4a';
        for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) if (xx * xx + yy * yy <= R * R && ((xx + yy) & 1)) b.fillRect(mx + xx, my + yy, 1, 1);
        b.globalAlpha = 0.6 + 0.4 * k; b.fillStyle = Math.floor(t * (6 + k * 20)) % 2 ? '#ff2a4a' : '#ffd23f';
        this.pring(b, mx, my, R, 2);
        b.globalAlpha = 1;
        this.mineSpin = (this.mineSpin || 0);
        const ang = t * (4 + k * k * 40);
        b.save(); b.translate(mx, my); b.rotate(Math.round(ang / (Math.PI / 8)) * (Math.PI / 8)); b.drawImage(spr, -4.5, -4.5); b.restore();
        const lit = Math.floor(t * (8 + k * 30)) % 2;
        b.fillStyle = lit ? '#ff2a4a' : '#ffffff'; b.fillRect(mx - 1, my - 1, 3, 3);
        continue;
      }
      b.globalAlpha = armed ? 1 : 0.5;
      b.drawImage(spr, mx - 4, my - 4);
      const lit = Math.floor(t * 2) % 2;
      b.fillStyle = lit && armed ? '#ffffff' : '#222222';
      b.fillRect(mx - 1, my - 1, 2, 2);
      b.globalAlpha = 1;
    }
  }

  pring(b, cx, cy, r, gap = 1) {
    const n = Math.max(8, Math.ceil(r * 6.3));
    for (let i = 0; i < n; i += gap) { const a = i / n * SP.TAU; b.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1); }
  }

  updateTrails(fr) {
    const seen = new Set();
    for (const s of fr.sh) {
      if (s.m === 'd') continue;
      seen.add(s.id);
      let tr = this.trails.get(s.id);
      if (!tr || tr.mode !== s.m) { tr = { mode: s.m, pts: [] }; this.trails.set(s.id, tr); }
      const last = tr.pts[tr.pts.length - 1];
      if (last && Math.hypot(last[0] - s.x, last[1] - s.y) > 60) tr.pts.length = 0;
      const back = s.m === 's' ? 14 : 9;
      tr.pts.push([s.x - Math.cos(s.a) * back, s.y - Math.sin(s.a) * back]);
      if (tr.pts.length > (s.dt > 0 ? 22 : 14)) tr.pts.shift();
    }
    for (const id of this.trails.keys()) if (!seen.has(id)) this.trails.delete(id);
  }
  drawTrails(b, fr) {
    for (const s of fr.sh) {
      const tr = this.trails.get(s.id);
      if (!tr || s.fr > 0) continue;
      const p = tr.pts, n = p.length;
      for (let i = 0; i < n; i++) {
        const k = i / n;
        if (k < 0.3 && i % 2) continue;
        b.globalAlpha = 0.25 + k * 0.6;
        b.fillStyle = s.dt > 0 ? '#ffffff' : k > 0.75 ? '#ffd23f' : s.c;
        b.fillRect(Math.round(p[i][0] / PX), Math.round(p[i][1] / PX), 1, 1);
      }
    }
    b.globalAlpha = 1;
  }

  drawBullets(b, fr) {
    for (const q of fr.bu) {
      const x = Math.round(q.x / PX), y = Math.round(q.y / PX);
      const sp = Math.hypot(q.vx, q.vy) || 1, ux = q.vx / sp, uy = q.vy / sp;
      if (q.k === 'm') {
        b.fillStyle = '#ffd23f'; b.fillRect(Math.round(x - ux * 3), Math.round(y - uy * 3), 1, 1);
        b.fillStyle = '#ff6a1f'; b.fillRect(Math.round(x - ux * 2), Math.round(y - uy * 2), 1, 1);
        b.fillStyle = q.c; b.fillRect(x - 1, y - 1, 3, 3);
        b.fillStyle = '#ffffff'; b.fillRect(Math.round(x + ux), Math.round(y + uy), 1, 1);
        if (Math.random() < 0.4) this.add({ k: 'smoke', x: q.x - ux * 10, y: q.y - uy * 10, life: 0.5, max: 0.5, size: 2 });
        continue;
      }
      if (q.k === 'i') {
        b.fillStyle = '#7fe9ff'; b.fillRect(x - 2, y, 5, 1); b.fillRect(x, y - 2, 1, 5);
        b.fillStyle = '#ffffff'; b.fillRect(x, y, 1, 1);
        continue;
      }
      const c = q.k === 'b' ? '#4dff88' : q.c;
      const spr = this.get('bullet' + c, () => sprite(BULLET_ROWS, { W: '#ffffff', c, o: shade(c, -0.5) }));
      b.save(); b.translate(x, y); b.rotate(Math.round(Math.atan2(q.vy, q.vx) / (Math.PI / 8)) * (Math.PI / 8));
      b.drawImage(spr, -4, -2);
      b.restore();
      b.fillStyle = c; b.globalAlpha = 0.5; b.fillRect(Math.round(x - ux * 6), Math.round(y - uy * 6), 1, 1); b.globalAlpha = 1;
    }
  }

  drawBeam(b, s) {
    const X = v => Math.round(v / PX);
    const ca = Math.cos(s.a), sa = Math.sin(s.a);
    if (s.ch > 0) {
      const k = 1 - s.ch / SP.C.LASER_CHARGE, off = (this.time * 30) % 4 | 0;
      b.fillStyle = '#4d8bff'; b.globalAlpha = 0.3 + k * 0.6;
      for (let d = 6 + off; d < 400; d += 4) b.fillRect(Math.round(X(s.x) + ca * d), Math.round(X(s.y) + sa * d), 1, 1);
      b.globalAlpha = 1;
      if (Math.random() < 0.5 + k * 0.5) this.burst(s.x + ca * 20, s.y + sa * 20, Math.random() < 0.5 ? '#ffffff' : '#4d8bff', 1, 1.5, 0.2);
    }
    if (s.bm > 0) {
      const x0 = X(s.x + ca * 18), y0 = X(s.y + sa * 18), x1 = X(s.bx), y1 = X(s.by);
      const len = Math.hypot(x1 - x0, y1 - y0), fade = Math.min(1, s.bm / 5), w = Math.random() < 0.5 ? 2 : 3;
      b.globalAlpha = fade * 0.35; b.fillStyle = '#1f4fd8';
      for (let d = 0; d <= len; d++) b.fillRect(Math.round(x0 + ca * d) - 2, Math.round(y0 + sa * d) - 2, 4, 4);
      b.globalAlpha = fade; b.fillStyle = '#2f6bff';
      for (let d = 0; d <= len; d++) b.fillRect(Math.round(x0 + ca * d) - 1, Math.round(y0 + sa * d) - 1, 2, 2);
      b.fillStyle = '#9fc4ff';
      for (let d = 0; d <= len; d++) b.fillRect(Math.round(x0 + ca * d), Math.round(y0 + sa * d), 1, 1);
      b.globalAlpha = 1;
      this.burst(s.bx, s.by, Math.random() < 0.5 ? '#ffffff' : '#4d8bff', 2, 3, 0.25);
    }
  }

  drawShip(b, s) {
    const t = this.time, x = Math.round(s.x / PX), y = Math.round(s.y / PX);
    if (s.iv > 0 && Math.floor(t * 16) % 2 === 0) b.globalAlpha = 0.3;
    // remaining shots orbit the ship
    if (!s.pw && s.fr <= 0) {
      for (let i = 0; i < SP.C.AMMO; i++) {
        const a = t * 2.6 + i * SP.TAU / SP.C.AMMO, ox = Math.round(x + Math.cos(a) * 11), oy = Math.round(y + Math.sin(a) * 11);
        if (i < s.am) { b.fillStyle = '#ffffff'; b.fillRect(ox - 1, oy - 1, 2, 2); b.fillStyle = s.c; b.fillRect(ox + (Math.cos(a + 1.57) > 0 ? 1 : -1), oy, 1, 1); }
        else if (i === s.am) { b.fillStyle = '#ffffff'; b.globalAlpha = 0.15 + s.rl * 0.5; b.fillRect(ox - 1, oy - 1, 2, 2); b.globalAlpha = s.iv > 0 && Math.floor(t * 16) % 2 === 0 ? 0.3 : 1; }
      }
    }
    b.save(); b.translate(x, y); b.rotate(s.a + Math.PI / 2);
    if (s.fr <= 0) {
      const hot = s.dt > 0 || s.jo > 0;
      const len = 2 + (Math.random() * 3 | 0) + (s.dt > 0 ? 6 : 0);
      const cols = hot ? ['#ffffff', '#ffd23f', '#ff6a1f', '#ff2a2a'] : ['#ffffff', '#9fe8ff', '#3fa9ff', '#1f4fd8'];
      for (let i = 0; i < len; i++) {
        const k = i / len, w = i < 2 ? 3 : i < len - 2 ? 2 : 1;
        b.fillStyle = cols[Math.min(3, (k * 4) | 0)];
        b.fillRect(-3 - Math.floor(w / 2), 7 + i, w, 1); b.fillRect(3 - Math.floor(w / 2), 7 + i, w, 1);
      }
      if (hot && Math.random() < 0.6) this.add({ k: 'px', x: s.x - Math.cos(s.a) * 30 + (Math.random() - 0.5) * 8, y: s.y - Math.sin(s.a) * 30 + (Math.random() - 0.5) * 8, vx: -Math.cos(s.a) * 1.5, vy: -Math.sin(s.a) * 1.5, life: 0.35, max: 0.35, c: Math.random() < 0.5 ? '#ff6a1f' : '#ffd23f', size: 1 });
    }
    if (s.jo > 0) {
      for (const sx of [s.jo & 2 ? -12 : null, s.jo & 1 ? 9 : null]) {
        if (sx === null) continue;
        b.fillStyle = '#0b3a1a'; b.fillRect(sx - 1, -6, 5, 12);
        b.fillStyle = '#4dff88'; b.fillRect(sx, -5, 3, 10);
        b.fillStyle = '#0b3a1a'; b.fillRect(sx, -2, 3, 1); b.fillRect(sx, 1, 3, 1);
      }
    }
    b.drawImage(this.shipSprite(s.c), -6.5, -7);
    if (s.fr > 0) {
      b.fillStyle = 'rgba(170,240,255,0.65)'; b.fillRect(-6, -7, 12, 14); b.fillRect(-7, -5, 14, 10);
      b.fillStyle = '#ffffff'; b.fillRect(-4, -5, 2, 1); b.fillRect(-5, -4, 1, 2);
    }
    b.restore();
    if (s.sd) { b.fillStyle = (Math.floor(t * 6) % 3) ? '#3fa9ff' : '#9fd4ff'; this.pring(b, x, y, 9); }
    if (s.iv > 0) { b.globalAlpha = 1; b.fillStyle = Math.floor(t * 12) % 2 ? '#ffffff' : '#9fc4ff'; this.pring(b, x, y, 10, 2); }
    if (s.pw) {
      const P = SP.POWERS[s.pw], a = t * 3, px = Math.round(x + Math.cos(a) * 11), py = Math.round(y + Math.sin(a) * 11);
      b.fillStyle = P.color; b.fillRect(px - 1, py - 1, 3, 3);
      b.fillStyle = '#ffffff'; b.fillRect(px, py, 1, 1);
    }
    b.globalAlpha = 1;
    if (s.rv > 0 && !(s.rv < 90 && Math.floor(t * 10) % 2)) this.drawReverse(b, x, y, 13);
  }
  drawReverse(b, x, y, r) {
    const t = this.time;
    b.fillStyle = '#8a8fa8';
    const n = Math.ceil(r * 6.3);
    for (let i = 0; i < n; i += 3) { const a = i / n * SP.TAU - t; b.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r), 1, 1); }
    const a = -t * 3, cx = Math.round(x + Math.cos(a) * r), cy = Math.round(y + Math.sin(a) * r);
    b.fillStyle = '#0b3a44'; b.fillRect(cx - 2, cy - 2, 4, 4);
    b.fillStyle = '#2ee6f0'; b.fillRect(cx - 1, cy - 1, 3, 3);
    b.fillStyle = '#ffffff'; b.fillRect(cx - 1, cy - 1, 1, 1);
  }

  // Knife slash: the blade sweeps across the pilot's front in a fast arc, leaving a white trail,
  // then a small spark burst at the tip.
  drawSlashes(b, fr) {
    if (!this.slashes || !this.slashes.length) return;
    const knife = this.get('knife', () => sprite(KNIFE_ROWS, { H: '#8a5a2b', G: '#c9cce0', S: '#ffffff', s: '#aeb6d4', W: '#ffffff' }));
    this.slashes = this.slashes.filter(sl => this.time - sl.t < SLASH_TIME + 0.12);
    for (const sl of this.slashes) {
      const p = fr.sh.find(q => q.id === sl.id && q.m === 'p');
      const cx = Math.round((p ? p.x : sl.x) / PX), cy = Math.round((p ? p.y : sl.y) / PX);
      const age = this.time - sl.t, k = Math.min(1, age / SLASH_TIME), e = 1 - Math.pow(1 - k, 3);
      const from = sl.a - 1.4 * sl.side, to = sl.a + 1.4 * sl.side, ang = from + (to - from) * e;
      // trail along the swept arc
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        const u = i / steps; if (u > e) break;
        const aa = from + (to - from) * u, fade = (1 - (e - u) * 2.2) * (age < SLASH_TIME ? 1 : 1 - (age - SLASH_TIME) / 0.12);
        if (fade <= 0) continue;
        b.globalAlpha = fade;
        b.fillStyle = u > e - 0.15 ? '#ffffff' : '#c9e8ff';
        // crescent: thick near the blade, thinning toward the start of the swing
        const th = 1 + Math.round(4 * u);
        for (let rr = 14 - th; rr <= 14; rr++) b.fillRect(Math.round(cx + Math.cos(aa) * rr), Math.round(cy + Math.sin(aa) * rr), 1, 1);
      }
      b.globalAlpha = 1;
      if (age < SLASH_TIME) {
        b.save(); b.translate(cx, cy); b.rotate(ang);
        b.drawImage(knife, 2, -2);
        b.restore();
      } else if (!sl.sparked) {
        sl.sparked = true;
        this.burst((p ? p.x : sl.x) + Math.cos(to) * 52, (p ? p.y : sl.y) + Math.sin(to) * 52, '#ffffff', 7, 3, 0.25);
      }
    }
  }

  // Scorch marks left by explosions, drawn on the ground under everything else.
  drawScorches(b) {
    for (const p of this.parts) {
      if (p.k !== 'scorch') continue;
      const k = p.life / p.max, x = Math.round(p.x / PX), y = Math.round(p.y / PX), R = Math.round(p.R / PX);
      b.globalAlpha = Math.min(0.55, k * 0.8); b.fillStyle = '#000000';
      for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) {
        const d = Math.sqrt(xx * xx + yy * yy) / R;
        if (d <= 1 && !(d > 0.7 && ((xx * 3 + yy * 7) & 3))) b.fillRect(x + xx, y + yy, 1, 1);
      }
    }
    b.globalAlpha = 1;
  }

  drawCrown(b, fr) {
    let best = null, top = 0, tie = false;
    for (const p of fr.pl) { if (p.s > top) { top = p.s; best = p; tie = false; } else if (p.s === top && top > 0) tie = true; }
    if (!best || tie) return;
    const s = fr.sh.find(q => q.id === best.id && q.m !== 'd');
    if (!s) return;
    const crown = this.get('crown', () => sprite(CROWN_ROWS, { Y: '#ffd23f', R: '#ff4766' }));
    b.drawImage(crown, Math.round(s.x / PX) - 3, Math.round(s.y / PX) - (s.m === 's' ? 17 : 14) + (Math.sin(this.time * 4) > 0 ? -1 : 0) - (s.rv > 0 ? 7 : 0));
  }

  // Ejected pilot: a little pixel astronaut drifting on a jetpack.
  drawPilot(b, s, fr) {
    const t = this.time, x = Math.round(s.x / PX), y = Math.round(s.y / PX);
    if (s.iv > 0 && Math.floor(t * 16) % 2 === 0) b.globalAlpha = 0.35;
    if (!fr.sd && s.rs > 0) {
      const k = 1 - s.rs / SP.C.RESPAWN, n = 36;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + i / n * SP.TAU;
        b.fillStyle = i / n < k ? s.c : '#22253a';
        b.fillRect(Math.round(x + Math.cos(a) * 8), Math.round(y + Math.sin(a) * 8), 1, 1);
      }
    }
    // Head points where the pilot faces; jet fire comes out of the feet while moving.
    if (s.mt > 0) { b.fillStyle = '#ffffff'; b.globalAlpha = s.mt / SP.C.MELEE_GUARD; this.pring(b, x, y, 9); b.globalAlpha = 1; }
    const spr = this.pilotSprite(s.c);
    b.save(); b.translate(x, y); b.rotate(s.a + Math.PI / 2);
    if (s.fr <= 0 && (s.ho > 0 || s.dt > 0)) {
      const len = 2 + (Math.random() * 2 | 0) + (s.dt > 0 ? 3 : 0);
      for (let i = 0; i < len; i++) {
        b.fillStyle = i === 0 ? '#ffffff' : i < 2 ? '#ffd23f' : '#ff6a1f';
        b.fillRect(-2, 7 + i, 1, 1); b.fillRect(1, 7 + i, 1, 1);
      }
    }
    b.drawImage(spr, -4.5, -7);
    b.restore();
    if (s.fr > 0) { b.fillStyle = 'rgba(170,240,255,0.65)'; b.fillRect(x - 5, y - 6, 10, 12); }
    b.globalAlpha = 1;
    if (s.rv > 0 && !(s.rv < 90 && Math.floor(t * 10) % 2)) this.drawReverse(b, x, y, 10);
  }

  stepParticles(b, dt) {
    const k60 = dt * 60, parts = this.parts;
    let write = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      parts[write++] = p;
      if (p.screen || p.k === 'text' || p.k === 'scorch') continue; // drawn in other passes
      if (p.k !== 'ring' && p.k !== 'flash') {
        p.x += p.vx * k60; p.y += p.vy * k60;
        const drag = Math.pow(p.k === 'smoke' ? 0.95 : 0.92, k60);
        p.vx *= drag; p.vy *= drag;
      }
      const k = p.life / p.max, x = Math.round(p.x / PX), y = Math.round(p.y / PX);
      switch (p.k) {
        case 'px': case 'shard':
          b.globalAlpha = k > 0.5 ? 1 : k * 2;
          b.fillStyle = p.c; b.fillRect(x, y, p.size, p.size);
          break;
        case 'smoke':
          b.globalAlpha = k * 0.45; b.fillStyle = k > 0.6 ? '#9a9ab0' : '#5a5a70';
          b.fillRect(x - (p.size >> 1), y - (p.size >> 1), p.size, p.size);
          break;
        case 'ring':
          b.globalAlpha = k; b.fillStyle = p.c;
          this.pring(b, x, y, Math.max(1, Math.round((p.r1 + (p.r0 - p.r1) * k) / PX)));
          break;
        case 'fireball': {
          // grows fast, then cools from white → yellow → orange → red → dark, with a dithered edge
          const grow = 1 - Math.pow(k, 3), R = Math.max(2, Math.round(p.R / PX * (0.35 + 0.65 * grow)));
          const cols = k > 0.75 ? ['#ffffff', '#fff3b0', '#ffd23f'] : k > 0.45 ? ['#fff3b0', '#ffd23f', '#ff7a1a'] : k > 0.2 ? ['#ffd23f', '#ff6a1f', '#c2410c'] : ['#ff6a1f', '#7a1f0a', '#3a1a14'];
          b.globalAlpha = Math.min(1, k * 3);
          for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) {
            const d = Math.sqrt(xx * xx + yy * yy) / R;
            if (d > 1) continue;
            if (d > 0.82 && ((xx + yy) & 1)) continue;
            b.fillStyle = d < 0.4 ? cols[0] : d < 0.72 ? cols[1] : cols[2];
            b.fillRect(x + xx, y + yy, 1, 1);
          }
          break;
        }
        case 'shock':
          b.globalAlpha = k; b.fillStyle = '#ffffff';
          this.pring(b, x, y, Math.max(1, Math.round((p.r1 + (p.r0 - p.r1) * k) / PX)));
          this.pring(b, x, y, Math.max(1, Math.round((p.r1 + (p.r0 - p.r1) * k) / PX) - 1), 2);
          break;
        case 'impact': {
          b.globalAlpha = 1; b.fillStyle = '#ffffff';
          const L = Math.round(3 + (1 - k) * 4);
          b.fillRect(x - L, y, L * 2 + 1, 1); b.fillRect(x, y - L, 1, L * 2 + 1);
          b.fillRect(x - 1, y - 1, 3, 3);
          b.fillStyle = '#ffd23f'; b.fillRect(x - 2, y - 2, 1, 1); b.fillRect(x + 2, y + 2, 1, 1); b.fillRect(x + 2, y - 2, 1, 1); b.fillRect(x - 2, y + 2, 1, 1);
          break;
        }
        case 'flash': {
          b.globalAlpha = Math.min(1, k * 1.5);
          const spr = this.get('flash' + p.r, () => disc(p.r, (dx, dy, dd, r) => dd < r * 0.5 ? '#ffffff' : ((dx + dy) & 1) ? '#fff3b0' : null));
          b.drawImage(spr, x - p.r, y - p.r);
          break;
        }
      }
    }
    parts.length = write;
    b.globalAlpha = 1;
  }

  // ------------------------------------------------------------ text & overlays
  pixText(g, str, x, y, size, color, alpha = 1, align = 'center') {
    if (alpha <= 0) return;
    g.globalAlpha = alpha;
    g.font = `${size}px ${FONT}`; g.textAlign = align; g.textBaseline = 'middle';
    const o = Math.max(1, Math.round(size / 8));
    g.fillStyle = '#000000';
    g.fillText(str, x + o, y + o); g.fillText(str, x - o, y); g.fillText(str, x + o, y - o); g.fillText(str, x, y + o);
    g.fillStyle = color; g.fillText(str, x, y);
    g.globalAlpha = 1;
  }
  drawTexts(g, dt) {
    const k60 = dt * 60;
    for (const p of this.parts) {
      if (p.k !== 'text') continue;
      p.y += p.vy * k60;
      this.pixText(g, p.s, Math.round(this.sx(p.x)), Math.round(this.sy(p.y)), p.size, p.c, Math.min(1, p.life / p.max * 2.5));
    }
  }
  drawConfetti(g, dt) {
    const k60 = dt * 60;
    for (const p of this.parts) {
      if (!p.screen) continue;
      p.x += p.vx * k60; p.y += p.vy * k60; p.vx += Math.sin(this.time * 3 + p.rot) * 0.02;
      g.globalAlpha = Math.min(1, p.life);
      g.fillStyle = p.c; g.fillRect(Math.round(p.x / 6) * 6, Math.round(p.y / 6) * 6, p.size, p.size / 2);
    }
    g.globalAlpha = 1;
  }

  drawLabels(g, fr, opts) {
    const early = fr.ph === 'countdown' || (fr.ph === 'play' && fr.pt < 120);
    for (const s of fr.sh) {
      if (s.m === 'd') continue;
      const mine = opts.me && opts.me === s.id;
      if (!early && !opts.names && !mine) continue;
      const p = fr.pl.find(q => q.id === s.id); if (!p) continue;
      const x = Math.round(this.sx(s.x)), y = Math.round(this.sy(s.y) - (s.m === 's' ? 24 : 20) * this.scale * this.view.z - 8 - (s.rv > 0 ? 10 : 0));
      this.pixText(g, mine ? 'YOU' : p.n, x, y, 8, p.c, early ? 1 : 0.7);
      if (mine && early) {
        const bob = Math.round(Math.sin(this.time * 8) * 2);
        g.fillStyle = '#ffffff';
        g.fillRect(x - 4, y - 14 + bob, 8, 2); g.fillRect(x - 2, y - 12 + bob, 4, 2);
      }
    }
  }

  drawOverlay(g, fr, opts) {
    const W = SP.W, H = SP.H, cx = W / 2, cy = H / 2;
    if (fr.ph === 'countdown') {
      const n = 3 - Math.floor(fr.pt / 40);
      if (n !== this.lastCount && n >= 1) { this.snd('count'); this.lastCount = n; }
      const k = (fr.pt % 40) / 40;
      this.pixText(g, `ROUND ${fr.rd}`, cx, cy - 130, 28, '#7fb2ff');
      this.pixText(g, fr.map.name.toUpperCase(), cx, cy - 88, 18, '#ffffff', 0.85);
      this.pixText(g, String(Math.max(1, n)), cx, cy + 10, Math.round(96 * (1.25 - k * 0.25) / 8) * 8, '#ffffff', 1 - k * 0.4);
    } else this.lastCount = -1;
    if (fr.ph === 'play' && fr.pt < 45) {
      const k = fr.pt / 45;
      this.pixText(g, 'GO!', cx, cy, Math.round((96 + k * 48) / 8) * 8, '#4dff88', 1 - k);
    }
    if (fr.sd && this.time - this.suddenAt < 2.5 && fr.ph === 'play') {
      const a = Math.min(1, (1 - (this.time - this.suddenAt) / 2.5) * 3);
      this.pixText(g, 'SUDDEN DEATH', cx, cy - 40, 48, '#ff4766', a);
      this.pixText(g, 'THE ARENA IS CLOSING IN', cx, cy + 20, 16, '#ffffff', a);
    }
    if (this.banner && fr.ph === 'play') {
      const k = (this.time - this.banner.t) / 1.8;
      if (k > 1) this.banner = null;
      else {
        const a = Math.min(1, (1 - k) * 4);
        this.pixText(g, this.banner.text, cx, 110, k < 0.1 ? 48 : 40, this.banner.color, a);
        this.pixText(g, this.banner.sub.toUpperCase(), cx, 160, 14, '#ffffff', a);
      }
    }
    if (fr.ph === 'roundEnd') {
      const p = fr.pl.find(q => q.id === fr.rw);
      const k = Math.min(1, fr.pt / 15);
      g.globalAlpha = 0.6 * k; g.fillStyle = '#000000'; g.fillRect(0, cy - 70, W, 140); g.globalAlpha = 1;
      if (p) {
        this.pixText(g, p.n.toUpperCase(), cx, cy - 20, 48, p.c, k);
        this.pixText(g, 'WINS THE ROUND', cx, cy + 34, 20, '#ffffff', k);
      } else this.pixText(g, 'DRAW', cx, cy, 56, '#ffffff', k);
    }
    if (fr.ph === 'scores') this.drawScoreBoard(g, fr);
    if (fr.ph === 'over') this.drawWinner(g, fr, opts);
  }

  // Astro Party-style race board: ships race from the start line to the checkered finish.
  drawScoreBoard(g, fr) {
    const W = SP.W, H = SP.H;
    const a = Math.max(0, Math.min(1, fr.pt / 12, (SP.C.SCORES - fr.pt) / 12));
    const rows = fr.pl, laneH = rows.length > 4 ? 84 : 100;
    const pw = 1040, ph = rows.length * laneH + 24;
    const px = (W - pw) / 2, py = Math.max(110, (H - ph) / 2 + 24);
    g.globalAlpha = a * 0.6; g.fillStyle = '#000000'; g.fillRect(0, 0, W, H);
    g.globalAlpha = a;
    this.pixText(g, `ROUND ${fr.rd}`, W / 2, py - 70, 28, '#ffffff', a);
    this.pixText(g, `FIRST TO ${fr.tg}`, W / 2, py - 34, 14, '#7fb2ff', a);
    g.globalAlpha = a;
    // frame
    g.fillStyle = '#1f4fd8'; g.fillRect(px - 12, py - 12, pw + 24, ph + 24);
    g.fillStyle = '#7fb2ff'; g.fillRect(px - 6, py - 6, pw + 12, ph + 12);
    g.fillStyle = '#05050c'; g.fillRect(px, py, pw, ph);
    g.fillStyle = '#121426';
    for (let i = 0; i < 180; i++) g.fillRect(px + ((i * 97) % (pw - 4)), py + ((i * 53) % (ph - 4)), 4, 4);
    const startX = px + 130, finishX = px + pw - 96;
    // start lines
    g.fillStyle = '#ffffff'; g.fillRect(px + 84, py, 6, ph); g.fillRect(px + 100, py, 3, ph);
    // checkered finish
    const cs = 16;
    for (let yy = 0; yy * cs < ph; yy++) for (let xx = 0; finishX + xx * cs < px + pw; xx++) {
      g.fillStyle = (xx + yy) % 2 ? '#ffffff' : '#000000';
      g.fillRect(finishX + xx * cs, py + yy * cs, Math.min(cs, px + pw - finishX - xx * cs), Math.min(cs, ph - yy * cs));
    }
    const anim = easeOut(Math.max(0, Math.min(1, (fr.pt - 40) / 60)));
    const step = (finishX - 30 - startX) / fr.tg;
    rows.forEach((p, i) => {
      const top = py + 12 + i * laneH, ly = top + laneH * 0.64;
      if (i > 0) { g.fillStyle = 'rgba(255,255,255,0.4)'; for (let dx = px + 110; dx < finishX - 10; dx += 40) g.fillRect(dx, top - 2, 20, 4); }
      g.fillStyle = 'rgba(255,255,255,0.18)';
      for (let k = 1; k < fr.tg; k++) g.fillRect(Math.round(startX + step * k) - 2, ly + 16, 4, 4);
      const shown = p.p + (p.s - p.p) * anim;
      const sxp = Math.round(startX + step * Math.max(0, Math.min(shown, fr.tg)));
      const hop = p.s > p.p && anim > 0 && anim < 1 ? Math.round(Math.abs(Math.sin(anim * Math.PI * Math.max(1, p.s - p.p))) * 12 / 4) * 4 : 0;
      // speed lines behind a ship that just scored
      if (p.s > p.p && anim > 0 && anim < 1) { g.fillStyle = p.c; for (let j = 1; j <= 3; j++) g.fillRect(sxp - 30 - j * 18, ly - hop - 8 + j * 4, 12, 4); }
      g.save(); g.imageSmoothingEnabled = false;
      g.translate(sxp, ly - hop); g.rotate(Math.PI / 2);
      g.drawImage(this.shipSprite(p.c), -22, -25, 44, 50);
      g.restore();
      this.pixText(g, p.n.toUpperCase(), sxp, ly - hop - 38, 14, p.c, a);
      this.pixText(g, String(p.s), px + 42, ly, 22, '#ffffff', a);
      if (p.s !== p.p && anim >= 1) this.pixText(g, (p.s > p.p ? '+' : '') + (p.s - p.p), sxp + 48, ly - 18, 12, p.s > p.p ? '#4dff88' : '#ff4766', a);
    });
    g.globalAlpha = 1;
  }

  drawWinner(g, fr, opts) {
    const W = SP.W, H = SP.H, cx = W / 2, cy = H / 2;
    const p = fr.pl.find(q => q.id === fr.mw);
    const k = Math.min(1, fr.pt / 30);
    g.globalAlpha = 0.75 * k; g.fillStyle = '#000000'; g.fillRect(0, 0, W, H); g.globalAlpha = 1;
    if (!p) return;
    g.save(); g.imageSmoothingEnabled = false;
    g.translate(cx, cy - 100); g.rotate(Math.round(this.time * 4) / 4 * 1.2);
    const s = Math.max(1, Math.round(10 * k));
    g.drawImage(this.shipSprite(p.c), -6.5 * s, -7.5 * s, 13 * s, 15 * s);
    g.restore();
    this.pixText(g, p.n.toUpperCase(), cx, cy + 40, 56, p.c, k);
    this.pixText(g, 'WINS THE MATCH!', cx, cy + 104, 24, '#ffffff', k);
    if (opts.overHint) this.pixText(g, opts.overHint.toUpperCase(), cx, H - 50, 12, '#7fb2ff', k * 0.8);
  }
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

// Breakable block tile sized to the block, styled per theme (stone, crystal, ice, obsidian, crate, metal).
function blockSprite(w, h, P, theme) {
  const c = makeCanvas(w, h), g = c.getContext('2d');
  const [o, hi, m, sh] = P;
  g.fillStyle = o; g.fillRect(0, 0, w, h);
  g.fillStyle = m; g.fillRect(1, 1, w - 2, h - 2);
  g.fillStyle = hi; g.fillRect(1, 1, w - 2, 1); g.fillRect(1, 1, 1, h - 2);
  g.fillStyle = sh; g.fillRect(1, h - 2, w - 2, 1); g.fillRect(w - 2, 1, 1, h - 2);
  if (theme === 'jungle' || theme === 'station') { // crate cross
    g.fillStyle = sh;
    for (let i = 2; i < Math.min(w, h) - 2; i++) { g.fillRect(i, i, 1, 1); g.fillRect(w - 1 - i, i, 1, 1); }
  } else if (theme === 'ice' || theme === 'nebula') { // shine
    g.fillStyle = hi; g.fillRect(3, 3, 2, 1); g.fillRect(3, 4, 1, 1);
  } else { // cracks
    g.fillStyle = o;
    g.fillRect(w >> 1, 3, 1, 2); g.fillRect((w >> 1) + 1, 5, 1, 2); g.fillRect(3, h - 4, 2, 1);
  }
  if (theme === 'lava') { g.fillStyle = '#ff6a1f'; g.fillRect(w - 4, 3, 1, 1); g.fillRect(3, (h >> 1), 1, 1); }
  return c;
}

// Pixel glyph for a powerup (used by the help screen).
function drawPowerIcon(g, type, s) {
  const gl = GLYPHS[type]; if (!gl) return;
  const c = Math.max(1, Math.round(s * 2 / 5));
  g.save(); g.fillStyle = '#ffffff';
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (gl[y][x] === '#') g.fillRect((x - 2.5) * c, (y - 2.5) * c, c, c);
  g.restore();
}

// Tiny static preview of a map for the lobby picker (pixel style).
function drawMapThumb(canvas, map) {
  const g = canvas.getContext('2d'), s = canvas.width / SP.W;
  g.setTransform(1, 0, 0, 1, 0, 0);
  const T = THEMES[map.theme] || THEMES.space;
  g.fillStyle = T.bg; g.fillRect(0, 0, canvas.width, canvas.height);
  const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x * s), Math.round(y * s), Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))); };
  g.fillStyle = T.wall[1]; g.fillRect(0, 0, canvas.width, 2); g.fillRect(0, canvas.height - 2, canvas.width, 2); g.fillRect(0, 0, 2, canvas.height); g.fillRect(canvas.width - 2, 0, 2, canvas.height);
  for (const h of map.hazards || []) R(h[0], h[1], h[2], h[3], T.hz[0]);
  for (const w of map.walls) R(w[0], w[1], w[2], w[3], T.wall[1]);
  for (const b of map.blocks) R(b[0] + 3, b[1] + 3, b[2] - 6, b[3] - 6, T.block[2]);
  const C = (x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x * s, y * s, r * s, 0, SP.TAU); g.fill(); };
  for (const c of map.circles) C(c.x, c.y, c.r, '#ff6a1f');
  for (const c of map.bumpers) C(c.x, c.y, c.r, '#ff4dd8');
  for (const a of map.asteroids) C(a[0], a[1], a[2], '#8a8fa8');
  if (map.sun) C(map.sun.x, map.sun.y, map.sun.r * 1.4, '#ffd23f');
  g.strokeStyle = T.wall[1]; g.lineCap = 'square';
  for (const sp of map.spinners) for (const sg of SP.spinSegs(sp, 0)) { g.lineWidth = sp.th * s * 1.5; g.beginPath(); g.moveTo(sg[0] * s, sg[1] * s); g.lineTo(sg[2] * s, sg[3] * s); g.stroke(); }
}
