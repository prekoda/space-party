/* Space Party shared simulation.
 * Runs authoritatively on the server for online rooms and in the browser for local play,
 * so both modes behave identically. Units: pixels and 60 Hz ticks. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const W = 1280, H = 800, CX = W / 2, CY = H / 2, TAU = Math.PI * 2, PI = Math.PI;
  const TICK_MS = 1000 / 60;

  const C = {
    SHIP_R: 22, PILOT_R: 14, SHIP_HIT: 24, PILOT_HIT: 17, BLADE_OFF: 40, BLADE_R: 15,
    // Ships steer toward where they point ("grip") and carry momentum through turns.
    SPEED: 4.2, GRIP: 0.075, TURN: 0.095,
    // Pilots: rotate spins on the spot; HOLD fire to jet forward; TAP fire to punch.
    PILOT_ACCEL: 0.17, PILOT_DRAG: 0.93, PILOT_STOP: 0.94, PILOT_TURN: 0.13, TAP_TICKS: 9, MELEE_GUARD: 14,
    // Double-tap = booster: a straight surge with fire, not an instant jump.
    BOOST_T: 20, BOOST_SPEED: 2.0, BOOST_GRIP: 0.25, BOOST_TURN: 0.75,
    PILOT_DASH: 4.2, DASH_CD: 50, MAX_SPEED: 12,
    MELEE_CD: 30, MELEE_REACH: 18, MELEE_R: 26,
    CRATE_SPEED: 0.7, CRATE_R: 22,
    WALL_BOUNCE: 0.45,
    BULLET_SPEED: 9, BULLET_R: 5, BULLET_LIFE: 120,
    AMMO: 3, RELOAD: 50, FIRE_CD: 6, FIRE_BUF: 10, RECOIL: 0.65,
    REVERSE: 600,
    SHRINK_RATE: 0.25, SHRINK_MAX: 400,
    RESPAWN: 360, RESPAWN_INVULN: 50, EJECT_INVULN: 4,
    LASER_CHARGE: 30, LASER_BEAM: 14,
    FREEZE: 150, JOUST: 720,
    MINE_ARM: 36, MINE_FUSE: 22, MINE_TRIGGER: 58, MINE_BLAST: 95,
    MISSILE_BLAST: 55,
    COUNTDOWN: 120, ROUND_END: 110, SCORES: 270, OVER: 480, END_GRACE: 40,
    SUDDEN: 60 * 60, DRAW: 110 * 60,
    CRATE_FIRST: 100, CRATE_EVERY: 300, CRATE_MAX: 4, ITEM_LIFE: 900,
  };

  const COLORS = ['#ff4766', '#3fa9ff', '#4dff88', '#ffd23f', '#b57bff', '#ff8c2e'];
  const COLOR_NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange'];
  const MAX_PLAYERS = 6;

  // Every powerup is something you want to grab — no "bad" pickups.
  const POWERS = {
    laser:  { name: 'LASER',    color: '#ff5470', uses: 1, w: 1.0 },
    triple: { name: 'TRIPLE',   color: '#ffd23f', uses: 3, w: 1.2 },
    bounce: { name: 'RICOCHET', color: '#4dff88', uses: 3, w: 1.0 },
    homing: { name: 'HOMING',   color: '#ff8c2e', uses: 2, w: 1.0 },
    mine:   { name: 'MINES',    color: '#ff4dd8', uses: 2, w: 0.9 },
    freeze: { name: 'FREEZE',   color: '#7fe9ff', uses: 2, w: 0.9 },
    shield: { name: 'SHIELD',   color: '#3fa9ff', instant: true, w: 1.0 },
    joust:  { name: 'JOUSTER',  color: '#e8e8ff', uses: 1, w: 0.8 },
    reverse: { name: 'REVERSE ALL', color: '#c77dff', instant: true, w: 0.6 },
  };
  const POWER_LIST = Object.keys(POWERS);

  // ---------------------------------------------------------------- helpers
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  function wrapA(a) { a %= TAU; return a < 0 ? a + TAU : a; }
  function adiff(a, b) { let d = (a - b) % TAU; if (d > PI) d -= TAU; else if (d < -PI) d += TAU; return d; }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const r1 = v => Math.round(v * 10) / 10;
  const r3 = v => Math.round(v * 1000) / 1000;

  function pickPower() {
    let total = 0; for (const k of POWER_LIST) total += POWERS[k].w;
    let x = Math.random() * total;
    for (const k of POWER_LIST) { x -= POWERS[k].w; if (x <= 0) return k; }
    return 'triple';
  }

  // ---------------------------------------------------------------- maps
  // Maps are 32×20 tile grids (40 world units per tile). Legend:
  //   .  empty    #  wall    b  breakable block    ~  hazard (lava / water / acid — kills)
  //   o  bumper   A  asteroid   P  spawn   V  vault crate spot   *  sun   X  spinner
  // Built-in maps are written as one 16×10 quarter and mirrored both ways so they're fair.
  const CELL = 40, GC = 32, GR = 20;
  const GRID_CHARS = '.#b~oAPV*X';
  const THEME_IDS = ['space', 'nebula', 'ice', 'lava', 'jungle', 'station'];

  // Spawn fallbacks (corners + mid sides); custom maps without P markers use these.
  const SPAWNS = [[110, 110, 0], [W - 110, H - 110, PI], [W - 110, 110, PI], [110, H - 110, 0], [80, CY, 0], [W - 80, CY, PI]];

  const mirrorQ = q => { const top = q.map(r => r + [...r].reverse().join('')); return top.concat(top.slice().reverse()); };
  function validRows(rows) {
    if (!Array.isArray(rows) || rows.length !== GR) return false;
    for (const r of rows) {
      if (typeof r !== 'string' || r.length !== GC) return false;
      for (const ch of r) if (!GRID_CHARS.includes(ch)) return false;
    }
    return true;
  }
  function validateMapDef(d) {
    return !!d && typeof d.id === 'string' && /^c_[a-z0-9]{3,20}$/.test(d.id) && typeof d.name === 'string' && d.name.length <= 20 &&
      THEME_IDS.includes(d.theme) && validRows(d.grid);
  }
  // Merges runs of one tile type into as few rectangles as possible.
  function mergeRects(rows, ch) {
    const out = [];
    let open = new Map();
    for (let y = 0; y < GR; y++) {
      const next = new Map();
      for (let x = 0; x < GC;) {
        if (rows[y][x] !== ch) { x++; continue; }
        const s = x; while (x < GC && rows[y][x] === ch) x++;
        const k = s + ',' + x, r = open.get(k);
        if (r) { r[3] += CELL; next.set(k, r); }
        else { const nr = [s * CELL, y * CELL, (x - s) * CELL, CELL]; out.push(nr); next.set(k, nr); }
      }
      open = next;
    }
    return out;
  }
  function buildGridMap(d) {
    const rows = d.grid || mirrorQ(d.q);
    if (!validRows(rows)) throw new Error('invalid map grid: ' + d.id);
    const m = {
      id: d.id, name: String(d.name || 'Custom').slice(0, 20), theme: THEME_IDS.includes(d.theme) ? d.theme : 'space', grid: rows,
      walls: mergeRects(rows, '#'), hazards: mergeRects(rows, '~'),
      blocks: [], circles: [], bumpers: [], spinners: [], asteroids: [], spawns: [],
    };
    const addSpinner = (x, y, len) => {
      m.spinners.push({ x, y, len, th: 16, arms: 2, speed: 0.012, a0: 0.3 });
      m.circles.push({ x, y, r: 26 });
    };
    for (let y = 0; y < GR; y++) for (let x = 0; x < GC; x++) {
      const ch = rows[y][x], cx = x * CELL + CELL / 2, cy = y * CELL + CELL / 2;
      if (ch === 'b') m.blocks.push([x * CELL, y * CELL, CELL, CELL]);
      else if (ch === 'o') m.bumpers.push({ x: cx, y: cy, r: 24 });
      else if (ch === 'A') m.asteroids.push([cx, cy, 42]);
      else if (ch === 'P' && m.spawns.length < 8) m.spawns.push([cx, cy, cx < CX ? 0 : PI]);
      else if (ch === 'V' && !m.vault) m.vault = { x: cx, y: cy };
      else if (ch === '*' && !m.sun) m.sun = { x: cx, y: cy, r: 44, g: 2100 };
      else if (ch === 'X' && !m.spinners.length) addSpinner(cx, cy, 320);
    }
    if (d.sun) m.sun = { x: CX, y: CY, r: 44, g: 2100 };
    if (d.spinner) addSpinner(CX, CY, d.spinner);
    if (d.bigBumper) m.bumpers.push({ x: CX, y: CY, r: 44 });
    if (d.vault) m.vault = { x: CX, y: CY };
    return m;
  }

  const MAP_DEFS = [
    { id: 'classic', name: 'Classic', theme: 'space', q: [
      '................',
      '.P..............',
      '................',
      '...#######......',
      '...#............',
      '...#............',
      '...#.......bb...',
      '...........bb...',
      '................',
      '..............bb',
    ] },
    { id: 'station', name: 'Space Station', theme: 'station', spinner: 340, q: [
      '................',
      '.P..............',
      '................',
      '......#####.....',
      '......#.........',
      '......b.........',
      '..###.b.........',
      '..#.............',
      '..#.......b.....',
      '................',
    ] },
    { id: 'lava', name: 'Lava Core', theme: 'lava', q: [
      '...............~',
      '.P.............~',
      '...............~',
      '....###........~',
      '....#...........',
      '....#...........',
      '...............~',
      '.......bb......~',
      '.......bb......~',
      '................',
    ] },
    { id: 'ice', name: 'Frost Caves', theme: 'ice', q: [
      '###.............',
      '#...............',
      '..P.............',
      '........###.....',
      '.......####.....',
      '........#......~',
      '..~~...........~',
      '..~~......bb....',
      '..........bb....',
      '###.............',
    ] },
    { id: 'jungle', name: 'Jungle Ruins', theme: 'jungle', q: [
      '................',
      '.P......#.......',
      '........#.......',
      '..##....b...##..',
      '..#.........#...',
      '........bb......',
      '....~~......b...',
      '....~~..........',
      '..#........#bb#.',
      '..b........#....',
    ] },
    { id: 'fortress', name: 'Fortress', theme: 'lava', vault: true, q: [
      '................',
      '.P..............',
      '................',
      '....#......####b',
      '....#......#....',
      '....#......#....',
      '..~~.......b....',
      '..~~.......b....',
      '...........#....',
      '...........#....',
    ] },
    { id: 'sun', name: 'Solar Flare', theme: 'nebula', sun: true, q: [
      '................',
      '.P..............',
      '................',
      '........bb......',
      '...#............',
      '...#............',
      '...#...b........',
      '........b.......',
      '................',
      '................',
    ] },
    { id: 'turbine', name: 'Turbine', theme: 'station', spinner: 400, q: [
      '................',
      '.P..............',
      '................',
      '....##..........',
      '....##..........',
      '................',
      '........b.......',
      '................',
      '..#.............',
      '..#.............',
    ] },
    { id: 'asteroids', name: 'Asteroid Belt', theme: 'space', q: [
      '................',
      '.P..............',
      '................',
      '................',
      '.......A........',
      '................',
      '................',
      '..............b.',
      '................',
      '................',
    ] },
    { id: 'pinball', name: 'Pinball', theme: 'nebula', bigBumper: true, q: [
      '................',
      '.P..............',
      '................',
      '....o.....o.....',
      '................',
      '..bb............',
      '.......o........',
      '................',
      '...........bb...',
      '................',
    ] },
  ];
  const MAPS = MAP_DEFS.map(buildGridMap);
  const MAP_BY_ID = {}; for (const m of MAPS) MAP_BY_ID[m.id] = m;
  function registerMap(def) { const m = buildGridMap(def); MAP_BY_ID[m.id] = m; return m; }

  function spinSegs(sp, t) {
    const out = [];
    for (let k = 0; k < sp.arms; k++) {
      const th = sp.a0 + sp.speed * t + k * PI / sp.arms;
      const dx = Math.cos(th) * sp.len / 2, dy = Math.sin(th) * sp.len / 2;
      out.push([sp.x - dx, sp.y - dy, sp.x + dx, sp.y + dy]);
    }
    return out;
  }
  function closestOnSeg(px, py, s) {
    const dx = s[2] - s[0], dy = s[3] - s[1];
    const t = clamp(((px - s[0]) * dx + (py - s[1]) * dy) / (dx * dx + dy * dy), 0, 1);
    return [s[0] + dx * t, s[1] + dy * t];
  }

  // ---------------------------------------------------------------- collision (circle bodies)
  let impact = 0; // strongest wall hit speed during the last collideWorld call
  const BOUNCE = 1 + C.WALL_BOUNCE;
  function pushRect(o, r, rc) {
    const x = rc[0], y = rc[1], w = rc[2], h = rc[3];
    const nx = o.x < x ? x : o.x > x + w ? x + w : o.x;
    const ny = o.y < y ? y : o.y > y + h ? y + h : o.y;
    let dx = o.x - nx, dy = o.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return false;
    let pen;
    if (d2 > 1e-8) { const d = Math.sqrt(d2); dx /= d; dy /= d; pen = r - d; }
    else {
      const l = o.x - x, rr = x + w - o.x, t = o.y - y, b = y + h - o.y, m = Math.min(l, rr, t, b);
      if (m === l) { dx = -1; dy = 0; } else if (m === rr) { dx = 1; dy = 0; } else if (m === t) { dx = 0; dy = -1; } else { dx = 0; dy = 1; }
      pen = m + r;
    }
    o.x += dx * pen; o.y += dy * pen;
    const vn = o.vx * dx + o.vy * dy;
    if (vn < 0) { o.vx -= dx * vn * BOUNCE; o.vy -= dy * vn * BOUNCE; if (-vn > impact) impact = -vn; }
    return true;
  }
  function pushCircle(o, r, c, bumper) {
    let dx = o.x - c.x, dy = o.y - c.y;
    const min = r + c.r, d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return false;
    const d = Math.sqrt(d2) || 1; dx /= d; dy /= d;
    o.x = c.x + dx * min; o.y = c.y + dy * min;
    const vn = o.vx * dx + o.vy * dy;
    if (bumper) {
      if (vn < 0) { o.vx -= dx * vn * 2; o.vy -= dy * vn * 2; }
      const out = o.vx * dx + o.vy * dy;
      if (out < 7.5) { o.vx += dx * (7.5 - out); o.vy += dy * (7.5 - out); }
    } else if (vn < 0) { o.vx -= dx * vn * BOUNCE; o.vy -= dy * vn * BOUNCE; if (-vn > impact) impact = -vn; }
    return true;
  }
  function pushSpinner(o, r, sp, tick) {
    let hit = false;
    for (const s of spinSegs(sp, tick)) {
      const q = closestOnSeg(o.x, o.y, s);
      let dx = o.x - q[0], dy = o.y - q[1];
      const min = r + sp.th / 2, d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 1; dx /= d; dy /= d;
      o.x = q[0] + dx * min; o.y = q[1] + dy * min;
      const svx = -sp.speed * (q[1] - sp.y), svy = sp.speed * (q[0] - sp.x);
      const vn = (o.vx - svx) * dx + (o.vy - svy) * dy;
      if (vn < 0) { o.vx -= dx * vn * BOUNCE; o.vy -= dy * vn * BOUNCE; if (-vn > impact) impact = -vn; }
      hit = true;
    }
    return hit;
  }

  // Shared ship physics — the client runs this same function to predict its own ship.
  // world: { map, blocks:boolean[], asteroids:[], tick, canMove, sim? }
  function moveShip(s, inp, w) {
    const pilot = s.mode === 'p';
    const r = pilot ? C.PILOT_R : C.SHIP_R;
    if (s.dashCd > 0) s.dashCd--;
    if (s.dashT > 0) s.dashT--;
    if (s.rev > 0) s.rev--;
    if (s.frozen > 0) {
      s.frozen--;
      s.vx *= 0.985; s.vy *= 0.985;
    } else {
      const boosting = !pilot && s.dashT > 0;
      if (pilot) {
        if (inp.h) { s.hold = (s.hold || 0) + 1; s.tapRel = 0; }
        else { s.tapRel = s.hold > 0 && s.hold <= C.TAP_TICKS ? 1 : 0; s.hold = 0; }
      } else { s.hold = 0; s.tapRel = 0; }
      if (inp.r) s.a = wrapA(s.a + (pilot ? C.PILOT_TURN : C.TURN * (boosting ? C.BOOST_TURN : 1)) * (s.rev > 0 ? -1 : 1));
      if (w.canMove) {
        const ca = Math.cos(s.a), sa = Math.sin(s.a);
        if (inp.d && s.dashCd === 0) {
          s.dashCd = C.DASH_CD;
          if (pilot) { s.vx += ca * C.PILOT_DASH; s.vy += sa * C.PILOT_DASH; s.dashT = 14; }
          else s.dashT = C.BOOST_T;
        }
        if (pilot) {
          if (s.hold > 0) { s.vx = (s.vx + ca * C.PILOT_ACCEL) * C.PILOT_DRAG; s.vy = (s.vy + sa * C.PILOT_ACCEL) * C.PILOT_DRAG; }
          else { s.vx *= C.PILOT_STOP; s.vy *= C.PILOT_STOP; }
        } else {
          let sp = C.SPEED, grip = C.GRIP;
          if (s.dashT > 0) { sp *= C.BOOST_SPEED; grip = C.BOOST_GRIP; }
          if (s.charge > 0 || s.beam > 0) sp *= 0.25;
          if (s.joust > 0) sp *= 1.25;
          s.vx += (ca * sp - s.vx) * grip; s.vy += (sa * sp - s.vy) * grip;
        }
      }
    }
    if (!w.canMove) { s.vx = 0; s.vy = 0; return 0; }
    const m = w.map;
    if (m.sun) {
      const dx = m.sun.x - s.x, dy = m.sun.y - s.y, d2 = Math.max(dx * dx + dy * dy, 1600), d = Math.sqrt(d2);
      const f = m.sun.g / d2; s.vx += dx / d * f; s.vy += dy / d * f;
    }
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > C.MAX_SPEED) { s.vx *= C.MAX_SPEED / sp; s.vy *= C.MAX_SPEED / sp; }
    s.x += s.vx; s.y += s.vy;
    return collideWorld(s, r, w);
  }

  // returns bit flags: 1 = touched sun, 2 = bumper, 4 = wall
  function collideWorld(o, r, w) {
    let f = 0;
    impact = 0;
    const B = C.WALL_BOUNCE;
    if (o.x < r) { o.x = r; if (o.vx < 0) { impact = Math.max(impact, -o.vx); o.vx *= -B; } f |= 4; }
    if (o.x > W - r) { o.x = W - r; if (o.vx > 0) { impact = Math.max(impact, o.vx); o.vx *= -B; } f |= 4; }
    if (o.y < r) { o.y = r; if (o.vy < 0) { impact = Math.max(impact, -o.vy); o.vy *= -B; } f |= 4; }
    if (o.y > H - r) { o.y = H - r; if (o.vy > 0) { impact = Math.max(impact, o.vy); o.vy *= -B; } f |= 4; }
    const m = w.map;
    for (const rc of m.walls) if (pushRect(o, r, rc)) f |= 4;
    for (let i = 0; i < m.blocks.length; i++) if (w.blocks[i] && pushRect(o, r, m.blocks[i])) f |= 4;
    for (const c of m.circles) if (pushCircle(o, r, c, false)) f |= 4;
    for (const c of m.bumpers) if (pushCircle(o, r, c, true)) f |= 2;
    for (const sp of m.spinners) if (pushSpinner(o, r, sp, w.tick)) f |= 4;
    if (m.sun && Math.hypot(o.x - m.sun.x, o.y - m.sun.y) < m.sun.r + r - 3) f |= 1;
    if (w.solids) for (const c of w.solids) if (c !== o && pushCircle(o, r, c, false)) f |= 8;
    for (const a of w.asteroids) {
      let dx = o.x - a.x, dy = o.y - a.y;
      const min = r + a.r, d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 1; dx /= d; dy /= d;
      o.x = a.x + dx * min; o.y = a.y + dy * min;
      const vn = (o.vx - a.vx) * dx + (o.vy - a.vy) * dy;
      if (vn < 0) {
        o.vx -= dx * vn * 1.4; o.vy -= dy * vn * 1.4;
        if (w.sim) { const k = 60 / (a.r * a.r); a.vx += dx * vn * k; a.vy += dy * vn * k; }
      }
      f |= 4;
    }
    return f;
  }

  // ---------------------------------------------------------------- bots
  const BOT_NAMES = ['Nova', 'Comet', 'Pulsar', 'Quasar', 'Orbit', 'Vega', 'Zenith', 'Rigel', 'Lyra', 'Ion'];
  const LEVELS = {
    easy:   { tol: 0.24, fire: 0.05, lead: 0.0, dodge: 0.03, look: 55, react: 22 },
    normal: { tol: 0.15, fire: 0.11, lead: 0.6, dodge: 0.12, look: 80, react: 10 },
    hard:   { tol: 0.09, fire: 0.45, lead: 1.0, dodge: 0.35, look: 105, react: 4 },
  };

  class Brain {
    constructor(level) { this.level = LEVELS[level] ? level : 'normal'; this.cfg = LEVELS[this.level]; this.wait = 0; this.targetId = null; this.retarget = 0; this.spin = 0; this.straight = 0; }
    think(g, s) {
      const inp = { r: 0, f: 0, d: 0, h: 0 };
      if (!s || s.mode === 'd' || s.frozen > 0) return inp;
      const cfg = this.cfg;
      const speed = Math.hypot(s.vx, s.vy);
      this.slow = speed < 1.3 && s.mode === 's' ? (this.slow || 0) + 1 : 0;
      if (this.slow > 35) { this.slow = 0; this.straight = 25; if (s.dashCd === 0) inp.d = 1; }
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      const look = cfg.look * 0.6 + speed * 6;
      let danger = false;
      for (let d = 18; d <= look; d += 10) if (g.solidAt(s.x + ca * d, s.y + sa * d, 10, true)) { danger = true; break; }
      if (g.map.sun && Math.hypot(s.x - g.map.sun.x, s.y - g.map.sun.y) < g.map.sun.r + 90) {
        const toSun = Math.atan2(g.map.sun.y - s.y, g.map.sun.x - s.x);
        if (Math.abs(adiff(toSun, s.a)) < 1.3) danger = true;
      }

      // Dodge incoming bullets
      if (s.dashCd === 0 && Math.random() < cfg.dodge) {
        for (const b of g.bullets) {
          if (b.owner === s.id) continue;
          const dx = s.x - b.x, dy = s.y - b.y, d = Math.hypot(dx, dy);
          if (d < 130 && (dx * b.vx + dy * b.vy) / (d * Math.hypot(b.vx, b.vy) + 1e-6) > 0.93) { inp.d = 1; break; }
        }
      }

      if (s.mode === 'p') {
        // Pilot: steer away from the nearest ship, dash out of trouble.
        let near = null, nd = 1e9;
        for (const o of g.ships) if (o !== s && o.mode === 's') { const d = Math.hypot(o.x - s.x, o.y - s.y); if (d < nd) { nd = d; near = o; } }
        let want = null;
        if (near && nd < 300) want = Math.atan2(s.y - near.y, s.x - near.x);
        let prey = null, pd = 1e9;
        for (const o of g.ships) if (o !== s && o.mode === 'p') { const d = Math.hypot(o.x - s.x, o.y - s.y); if (d < pd) { pd = d; prey = o; } }
        if (!want && prey && pd < 260) want = Math.atan2(prey.y - s.y, prey.x - s.x);
        if (danger) { inp.r = 1; return inp; }
        if (want === null) { inp.r = Math.random() < 0.1 ? 1 : 0; inp.h = Math.random() < 0.6 ? 1 : 0; return inp; }
        const off = Math.abs(adiff(want, s.a));
        inp.r = off > 0.4 ? 1 : 0;
        inp.h = off < 0.9 ? 1 : 0;
        // punch: a short tap (release) when a pilot is in reach or a ship is about to ram us
        if ((prey && pd < 60) || (near && nd < 70)) { this.punch = (this.punch || 0) + 1; inp.h = this.punch < 3 ? 1 : 0; if (this.punch > 4) this.punch = 0; }
        if (near && nd < 110 && s.dashCd === 0 && Math.random() < 0.15) inp.d = 1;
        return inp;
      }

      // Choose a target: nearest living opponent (pilots look juicier), re-evaluated periodically.
      if (--this.retarget <= 0 || !g.shipById(this.targetId) || g.shipById(this.targetId).mode === 'd') {
        this.retarget = 40; let best = null, bd = 1e9;
        for (const o of g.ships) {
          if (o === s || o.mode === 'd') continue;
          const d = Math.hypot(o.x - s.x, o.y - s.y) * (o.mode === 'p' ? 0.6 : 1);
          if (d < bd) { bd = d; best = o; }
        }
        this.targetId = best ? best.id : null;
      }
      const t = g.shipById(this.targetId);
      let aimX, aimY, dist = 1e9, shootable = false;
      if (t) {
        dist = Math.hypot(t.x - s.x, t.y - s.y);
        const lt = dist / C.BULLET_SPEED * cfg.lead;
        aimX = t.x + t.vx * lt; aimY = t.y + t.vy * lt; shootable = true;
      }
      // Grab powerups / crack crates when we have nothing.
      if (!s.power) {
        for (const it of g.items) { const d = Math.hypot(it.x - s.x, it.y - s.y); if (d < dist * 0.7) { dist = d; aimX = it.x; aimY = it.y; shootable = false; } }
        for (const c of g.crates) { const d = Math.hypot(c.x - s.x, c.y - s.y); if (d < dist * 0.6) { dist = d; aimX = c.x; aimY = c.y; shootable = true; } }
      }
      if (aimX === undefined) { inp.r = danger || Math.random() < 0.2 ? 1 : 0; return inp; }

      const want = Math.atan2(aimY - s.y, aimX - s.x);
      const diff = adiff(want, s.a);
      inp.r = danger || Math.abs(diff) > cfg.tol ? 1 : 0;
      // Don't orbit forever: after a long turn, straighten out like a human would.
      if (this.straight > 0) { this.straight--; inp.r = danger && this.straight < 8 ? 1 : 0; }
      else if (inp.r && ++this.spin > 100) { this.spin = 0; this.straight = 20 + ((Math.random() * 20) | 0); }
      if (!inp.r) this.spin = 0;

      if (this.wait > 0) { this.wait--; return inp; }
      if (!shootable || s.charge > 0 || s.beam > 0) return inp;
      const clear = g.clearLine(s.x, s.y, aimX, aimY);
      const p = s.power;
      if (p === 'joust') {
        if (t && dist < 320) inp.f = 1;
      } else if (p === 'mine') {
        if (t && dist < 200 && Math.abs(diff) > 2.2) inp.f = 1;
        else if (Math.random() < 0.004) inp.f = 1;
      } else if (p === 'homing') {
        if (t && dist < 800 && Math.random() < 0.03) inp.f = 1;
      } else if (p === 'laser') {
        if (Math.abs(diff) < 0.12 && dist < 900 && Math.random() < cfg.fire) inp.f = 1;
      } else if (p === 'bounce') {
        if (Math.abs(diff) < cfg.tol * 1.6 && dist < 650 && Math.random() < cfg.fire) inp.f = 1;
      } else if (Math.abs(diff) < cfg.tol * 1.6 && dist < 650 && clear && (s.ammo > 0 || p) && Math.random() < cfg.fire) inp.f = 1;
      if (inp.f) this.wait = cfg.react;
      else if (t && Math.abs(diff) < 0.2 && dist > 350 && s.dashCd === 0 && this.level === 'hard' && Math.random() < 0.01) inp.d = 1;
      return inp;
    }
  }

  // ---------------------------------------------------------------- game
  const NO_INPUT = { r: 0, f: 0, d: 0, h: 0 };

  class Game {
    constructor() {
      this.players = [];
      this.settings = { map: 'random', target: 10 };
      this.phase = 'lobby'; this.phaseT = 0; this.frame = 0; this.round = 0;
      this.events = []; this.brains = {}; this.mapQueue = [];
      this.nextId = 1;
      this.ships = []; this.bullets = []; this.mines = []; this.items = []; this.crates = []; this.asteroids = [];
      this.map = MAPS[0]; this.blocks = []; this.tick = 0;
      this.roundWinner = null; this.matchWinner = null;
      this.sim = true;
      this.extraMaps = {};
      this.shrink = 0;
    }

    // ---- players
    freeColor(pref) {
      const used = new Set(this.players.map(p => p.color));
      if (pref && COLORS.includes(pref) && !used.has(pref)) return pref;
      return COLORS.find(c => !used.has(c)) || COLORS[0];
    }
    addPlayer(o) {
      if (this.players.length >= MAX_PLAYERS) return null;
      const p = { id: o.id, name: (o.name || 'Pilot').slice(0, 14), color: this.freeColor(o.color), score: 0, prev: 0, bot: o.bot || null };
      if (p.bot) {
        this.brains[p.id] = new Brain(p.bot);
        if (!o.name) { const used = new Set(this.players.map(q => q.name)); p.name = BOT_NAMES.find(n => !used.has(n)) || 'Bot'; }
      }
      this.players.push(p);
      return p;
    }
    removePlayer(id) {
      this.players = this.players.filter(p => p.id !== id);
      this.ships = this.ships.filter(s => s.id !== id);
      delete this.brains[id];
    }
    player(id) { return this.players.find(p => p.id === id); }
    cycleColor(id) {
      const p = this.player(id); if (!p) return;
      const used = new Set(this.players.filter(q => q !== p).map(q => q.color));
      let i = COLORS.indexOf(p.color);
      for (let k = 0; k < COLORS.length; k++) { i = (i + 1) % COLORS.length; if (!used.has(COLORS[i])) { p.color = COLORS[i]; return; } }
    }
    shipById(id) { if (id == null) return null; for (const s of this.ships) if (s.id === id) return s; return null; }
    ev(o) { o.f = this.frame; this.events.push(o); }
    takeEvents() { const e = this.events; this.events = []; return e; }

    // ---- match flow
    startMatch() {
      if (this.players.length < 2) return false;
      for (const p of this.players) { p.score = 0; p.prev = 0; }
      this.round = 0; this.matchWinner = null; this.mapQueue = [];
      this.nextRound();
      return true;
    }
    pickMap() {
      const chosen = this.extraMaps[this.settings.map] || (this.settings.map !== 'random' && MAP_BY_ID[this.settings.map]);
      if (chosen) return chosen;
      if (!this.mapQueue.length) {
        this.mapQueue = shuffle(MAPS.map(m => m.id));
        if (this.mapQueue[0] === this.map.id && this.mapQueue.length > 1) this.mapQueue.push(this.mapQueue.shift());
      }
      return MAP_BY_ID[this.mapQueue.shift()];
    }
    nextRound() {
      this.round++;
      this.map = this.pickMap();
      const m = this.map;
      this.tick = 0; this.sudden = false; this.endWait = 0; this.roundWinner = null; this.shrink = 0;
      this.blocks = m.blocks.map(() => true);
      this.bullets = []; this.mines = []; this.items = []; this.crates = [];
      this.asteroids = m.asteroids.map(a => this.newAsteroid(a[0], a[1], a[2], rnd(0, TAU), rnd(0.6, 1.2)));
      this.crateT = C.CRATE_FIRST;
      const order = shuffle(this.players.slice());
      this.ships = [];
      const spawns = this.spawnPoints();
      this.ships = order.map((p, i) => this.newShip(p, spawns[i % spawns.length]));
      for (const p of this.players) p.prev = p.score;
      this.phase = 'countdown'; this.phaseT = 0;
      this.ev({ e: 'round', n: this.round, map: m.id });
    }
    // Map spawn markers first, then fallbacks; each nudged out of walls/hazards, ordered so
    // consecutive players start as far apart as possible.
    spawnPoints() {
      const m = this.map;
      const cands = m.spawns.concat(SPAWNS.filter(d => !m.spawns.some(q => Math.hypot(q[0] - d[0], q[1] - d[1]) < 140)));
      const free = [];
      for (const c of cands) {
        const p = this.freeNear(c[0], c[1]);
        if (p && !free.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 60)) free.push([p[0], p[1], c[2]]);
      }
      if (!free.length) free.push([CX, CY, 0]);
      const out = [free.shift()];
      while (free.length) {
        let bi = 0, bd = -1;
        free.forEach((f, i) => { const d = Math.min(...out.map(o => Math.hypot(o[0] - f[0], o[1] - f[1]))); if (d > bd) { bd = d; bi = i; } });
        out.push(free.splice(bi, 1)[0]);
      }
      return out;
    }
    freeNear(x, y) {
      const ok = (px, py) => px > 30 && py > 30 && px < W - 30 && py < H - 30 && !this.solidAt(px, py, 26, false) && !this.inHazard(px, py, 34) &&
        !(this.map.sun && Math.hypot(px - this.map.sun.x, py - this.map.sun.y) < 140);
      if (ok(x, y)) return [x, y];
      for (let r = 30; r < 420; r += 20) for (let k = 0; k < 16; k++) {
        const a = k / 16 * TAU, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (ok(px, py)) return [px, py];
      }
      return null;
    }
    inHazard(x, y, pad) {
      for (const h of this.map.hazards) if (inRect(x, y, h, pad)) return true;
      return false;
    }
    newShip(p, sp) {
      return { id: p.id, color: p.color, x: sp[0], y: sp[1], a: sp[2], vx: 0, vy: 0, mode: 's', ammo: C.AMMO, reload: 0, fireCd: 0,
        dashCd: 0, dashT: 0, power: null, uses: 0, shield: 0, joust: 0, frozen: 0, charge: 0, beam: 0, bx: 0, by: 0,
        invuln: 0, respawn: 0, beamHits: null, rev: 0, fireBuf: 0, wallCd: 0, meleeCd: 0, hold: 0, tapRel: 0, meleeT: 0 };
    }
    newAsteroid(x, y, r, dir, sp) {
      return { id: this.nextId++, x, y, r, vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp, a: rnd(0, TAU), va: rnd(-0.02, 0.02) };
    }

    step(inputs) {
      this.frame++; this.phaseT++;
      inputs = inputs || {};
      for (const id in this.brains) {
        const s = this.shipById(id);
        if (s) inputs[id] = this.brains[id].think(this, s);
      }
      switch (this.phase) {
        case 'lobby': return;
        case 'countdown':
          this.simStep(inputs, false);
          if (this.phaseT >= C.COUNTDOWN) { this.phase = 'play'; this.phaseT = 0; this.ev({ e: 'go' }); }
          break;
        case 'play':
          this.simStep(inputs, true);
          this.checkRoundEnd();
          break;
        case 'roundEnd':
          if (this.phaseT % 3 === 0) this.simStep(inputs, true);
          if (this.phaseT >= C.ROUND_END) { this.phase = 'scores'; this.phaseT = 0; }
          break;
        case 'scores':
          if (this.phaseT >= C.SCORES) {
            const top = this.players.slice().sort((a, b) => b.score - a.score);
            if (top[0] && top[0].score >= this.settings.target && (!top[1] || top[1].score < top[0].score)) {
              this.matchWinner = top[0].id; this.phase = 'over'; this.phaseT = 0;
              this.ev({ e: 'matchWin', id: top[0].id });
            } else this.nextRound();
          }
          break;
        case 'over':
          if (this.phaseT >= C.OVER) { this.phase = 'lobby'; this.phaseT = 0; this.ships = []; }
          break;
      }
    }

    checkRoundEnd() {
      if (!this.sudden && this.tick >= C.SUDDEN) { this.sudden = true; this.ev({ e: 'sudden' }); }
      const alive = this.ships.filter(s => s.mode !== 'd');
      const draw = this.tick >= C.DRAW;
      if (alive.length <= 1 || draw) this.endWait++; else this.endWait = 0;
      if (this.endWait >= C.END_GRACE || draw) {
        const w = !draw && alive.length === 1 ? alive[0] : null;
        this.roundWinner = w ? w.id : null;
        if (w) { const p = this.player(w.id); if (p) p.score++; }
        this.phase = 'roundEnd'; this.phaseT = 0;
        this.ev({ e: 'roundWin', id: this.roundWinner });
      }
    }

    get canMove() { return this.phase !== 'countdown'; }
    // Orbs are solid for everything that flies into them.
    get solids() { return this.crateSolids; }

    simStep(inputs, live) {
      this.tick++;
      if (this.sudden && live) this.shrink = Math.min(C.SHRINK_MAX, this.shrink + C.SHRINK_RATE);
      this.updateAsteroids();
      this.crateSolids = this.crates.map(c => ({ x: c.x, y: c.y, r: C.CRATE_R, ref: c }));
      const world = this;
      for (const s of this.ships) {
        if (s.mode === 'd') continue;
        const inp = inputs[s.id] || NO_INPUT;
        if (s.invuln > 0) s.invuln--;
        if (s.fireCd > 0) s.fireCd--;
        if (s.mode === 'p' && live && !this.sudden && --s.respawn <= 0) {
          s.mode = 's'; s.invuln = C.RESPAWN_INVULN; s.ammo = C.AMMO; s.reload = 0; s.frozen = 0;
          this.ev({ e: 'respawn', id: s.id, x: s.x, y: s.y, c: s.color });
        }
        if (s.mode === 's' && s.ammo < C.AMMO && ++s.reload >= C.RELOAD) { s.ammo++; s.reload = 0; }
        if (s.meleeCd > 0) s.meleeCd--;
        if (s.mode === 's' && s.dashT > 0 && this.canMove) this.boostSmash(s);
        if (s.meleeT > 0) s.meleeT--;
        const wasDash = s.dashCd;
        const fl = moveShip(s, inp, world);
        if (live && s.mode === 'p' && s.tapRel && s.meleeCd <= 0 && s.frozen <= 0) { s.tapRel = 0; this.melee(s); }
        if (s.dashCd > wasDash) this.ev({ e: 'dash', id: s.id });
        if (fl & 2) this.ev({ e: 'bump', x: r1(s.x), y: r1(s.y) });
        if (s.wallCd > 0) s.wallCd--;
        else if ((fl & 4) && impact > 1.6) { s.wallCd = 12; this.ev({ e: 'wall', id: s.id, x: r1(s.x), y: r1(s.y), k: r1(impact) }); }
        if (fl & 1) {
          const a = Math.atan2(s.y - this.map.sun.y, s.x - this.map.sun.x);
          this.envKill(s, Math.cos(a) * 6, Math.sin(a) * 6);
        }
        if (s.mode !== 'd' && s.invuln <= 0) {
          const r = (s.mode === 'p' ? C.PILOT_R : C.SHIP_R) * 0.6;
          let hit = false;
          for (const h of this.map.hazards) if (inRect(s.x, s.y, h, r)) { hit = true; break; }
          if (hit) { this.ev({ e: 'hazard', x: r1(s.x), y: r1(s.y), id: s.id }); this.envKill(s, -s.vx * 1.4, -s.vy * 1.4); }
          else if (this.shrink > 0) {
            const mx = this.shrink, my = mx * H / W;
            if (s.x < mx || s.x > W - mx || s.y < my || s.y > H - my) {
              const a = Math.atan2(CY - s.y, CX - s.x);
              this.ev({ e: 'zap', x: r1(s.x), y: r1(s.y), id: s.id });
              this.envKill(s, Math.cos(a) * 5, Math.sin(a) * 5);
            }
          }
        }
        // A tap during the short fire cooldown is buffered instead of being swallowed.
        if (live && inp.f) s.fireBuf = C.FIRE_BUF;
        if (s.fireBuf > 0) {
          s.fireBuf--;
          if (s.mode !== 's' || s.frozen > 0) s.fireBuf = 0;
          else if (s.fireCd === 0 && s.charge === 0 && s.beam === 0) { s.fireBuf = 0; this.tryFire(s); }
        }
        if (s.charge > 0 && --s.charge === 0) { s.beam = C.LASER_BEAM; s.beamHits = new Set(); this.ev({ e: 'laser', id: s.id }); }
        if (s.beam > 0) { this.fireBeam(s); s.beam--; }
      }
      this.shipContacts();
      this.updateBullets();
      this.updateMines();
      this.updateItems(live);
    }

    // Boosting ships smash through breakable blocks and boxes in front of them.
    boostSmash(s) {
      const nx = s.x + s.vx * 2, ny = s.y + s.vy * 2, r = C.SHIP_R + 6, m = this.map;
      for (let i = 0; i < m.blocks.length; i++) {
        if (!this.blocks[i]) continue;
        const b = m.blocks[i];
        if (inRect(nx, ny, b, r)) { this.breakBlock(i); this.ev({ e: 'smash', x: r1(b[0] + b[2] / 2), y: r1(b[1] + b[3] / 2) }); }
      }
      for (const c of this.crates) if (!c.dead && Math.hypot(c.x - nx, c.y - ny) < r + C.CRATE_R) this.breakCrate(c, s.id);
      this.crates = this.crates.filter(c => !c.dead);
    }
    // Pilots can't shoot, but they can punch: kills other pilots, shoves ships, cracks boxes.
    melee(s) {
      s.meleeCd = C.MELEE_CD; s.meleeT = C.MELEE_GUARD;
      const hx = s.x + Math.cos(s.a) * C.MELEE_REACH, hy = s.y + Math.sin(s.a) * C.MELEE_REACH;
      this.ev({ e: 'melee', id: s.id, x: r1(hx), y: r1(hy), a: r3(s.a) });
      for (const o of this.ships) {
        if (o === s || o.mode === 'd' || o.invuln > 0) continue;
        const d = Math.hypot(o.x - hx, o.y - hy), rr = C.MELEE_R + (o.mode === 'p' ? C.PILOT_R : C.SHIP_R);
        if (d > rr) continue;
        if (o.mode === 'p') this.eliminate(o, s.id);
        else { const a = Math.atan2(o.y - s.y, o.x - s.x); o.vx += Math.cos(a) * 5; o.vy += Math.sin(a) * 5; this.ev({ e: 'bonk', x: r1(o.x), y: r1(o.y) }); }
      }
      for (const c of this.crates) if (!c.dead && Math.hypot(c.x - hx, c.y - hy) < C.MELEE_R + C.CRATE_R) this.breakCrate(c, null);
      this.crates = this.crates.filter(c => !c.dead);
      const m = this.map;
      for (let i = 0; i < m.blocks.length; i++) if (this.blocks[i] && inRect(hx, hy, m.blocks[i], C.MELEE_R * 0.6)) this.breakBlock(i);
    }

    // ---- weapons
    tryFire(s) {
      if (s.fireCd > 0 || s.charge > 0 || s.beam > 0) return;
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      if (s.power) {
        const p = s.power;
        this.ev({ e: 'use', id: s.id, t: p });
        if (p === 'laser') { s.charge = C.LASER_CHARGE; this.ev({ e: 'charge', id: s.id }); }
        else if (p === 'triple') { for (const o of [-0.2, 0, 0.2]) this.spawnBullet(s, s.a + o, 'n'); this.ev({ e: 'shot', id: s.id, k: 't' }); }
        else if (p === 'bounce') { this.spawnBullet(s, s.a, 'b'); this.ev({ e: 'shot', id: s.id, k: 'b' }); }
        else if (p === 'homing') { this.spawnBullet(s, s.a, 'm'); this.ev({ e: 'shot', id: s.id, k: 'm' }); }
        else if (p === 'freeze') { this.spawnBullet(s, s.a, 'i'); this.ev({ e: 'shot', id: s.id, k: 'i' }); }
        else if (p === 'joust') s.joust = 3; // deploy both blades
        else if (p === 'mine') {
          this.mines.push({ id: this.nextId++, x: s.x - ca * 24, y: s.y - sa * 24, owner: s.id, c: s.color, arm: C.MINE_ARM, fuse: 0 });
          this.ev({ e: 'drop', id: s.id });
        }
        s.fireCd = C.FIRE_CD;
        if (--s.uses <= 0) { s.power = null; s.uses = 0; }
        if (p !== 'mine' && p !== 'laser' && p !== 'joust') { s.vx -= ca * C.RECOIL * 1.5; s.vy -= sa * C.RECOIL * 1.5; }
        return;
      }
      if (s.ammo <= 0) { this.ev({ e: 'dry', id: s.id }); return; }
      s.ammo--; s.fireCd = C.FIRE_CD;
      this.spawnBullet(s, s.a, 'n');
      s.vx -= ca * C.RECOIL; s.vy -= sa * C.RECOIL;
      this.ev({ e: 'shot', id: s.id, k: 'n' });
    }
    spawnBullet(s, a, kind) {
      const ca = Math.cos(a), sa = Math.sin(a);
      const sp = kind === 'm' ? 3 : kind === 'i' ? 8 : C.BULLET_SPEED;
      this.bullets.push({ id: this.nextId++, x: s.x + ca * (C.SHIP_R + 3), y: s.y + sa * (C.SHIP_R + 3), vx: ca * sp, vy: sa * sp,
        owner: s.id, c: s.color, k: kind, life: kind === 'm' ? 360 : kind === 'b' ? 240 : C.BULLET_LIFE, bounces: kind === 'b' ? 4 : 0, hops: 0 });
    }

    fireBeam(s) {
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      let x = s.x + ca * 18, y = s.y + sa * 18;
      const m = this.map;
      s.vx -= ca * 0.22; s.vy -= sa * 0.22;
      for (let d = 0; d < 1600; d += 6) {
        x += ca * 6; y += sa * 6;
        if (x < 0 || y < 0 || x > W || y > H) break;
        for (let i = 0; i < m.blocks.length; i++) if (this.blocks[i] && inRect(x, y, m.blocks[i], 2)) this.breakBlock(i);
        for (const c of this.crates) if (!c.dead && Math.hypot(c.x - x, c.y - y) < C.CRATE_R) this.breakCrate(c, s.id);
        for (const a of this.asteroids) if (!a.dead && Math.hypot(a.x - x, a.y - y) < a.r) this.splitAsteroid(a, true);
        for (const mn of this.mines) if (!mn.dead && Math.hypot(mn.x - x, mn.y - y) < 14) this.detonate(mn);
        for (const b of this.bullets) if (!b.dead && b.k === 'm' && Math.hypot(b.x - x, b.y - y) < 12) this.explodeMissile(b);
        for (const o of this.ships) {
          if (o === s || o.mode === 'd' || s.beamHits.has(o.id)) continue;
          const r = (o.mode === 'p' ? C.PILOT_R : C.SHIP_R) + 6;
          if (Math.hypot(o.x - x, o.y - y) < r && o.invuln <= 0) { s.beamHits.add(o.id); this.laserKill(o, s.id); }
        }
      }
      this.crates = this.crates.filter(c => !c.dead);
      this.asteroids = this.asteroids.filter(a => !a.dead);
      s.bx = x; s.by = y;
    }

    // ---- damage
    laserKill(o, by) {
      if (o.mode === 's') this.ev({ e: 'kill', id: o.id, by, x: r1(o.x), y: r1(o.y), c: o.color, a: r3(o.a) });
      o.shield = 0; o.joust = 0; o.frozen = 0;
      this.eliminate(o, by);
    }
    hitShip(s, by, kind) {
      if (s.mode === 'd' || s.invuln > 0) return false;
      if (s.shield) { s.shield = 0; s.invuln = 24; this.ev({ e: 'shieldPop', id: s.id, x: r1(s.x), y: r1(s.y) }); return true; }
      if (s.frozen > 0) { this.ev({ e: 'shatter', x: r1(s.x), y: r1(s.y), c: s.color }); this.eliminate(s, by, true); return true; }
      if (kind === 'ice') { s.frozen = C.FREEZE; s.charge = 0; s.beam = 0; this.ev({ e: 'freeze', id: s.id, x: r1(s.x), y: r1(s.y) }); return true; }
      if (s.mode === 's') this.destroyShip(s, by); else this.eliminate(s, by);
      return true;
    }
    destroyShip(s, by) {
      this.ev({ e: 'kill', id: s.id, by, x: r1(s.x), y: r1(s.y), c: s.color, a: r3(s.a) });
      s.mode = 'p'; s.power = null; s.uses = 0; s.joust = 0; s.charge = 0; s.beam = 0; s.frozen = 0; s.shield = 0;
      s.invuln = C.EJECT_INVULN; s.respawn = C.RESPAWN;
      const a = rnd(0, TAU);
      s.vx = s.vx * 0.4 + Math.cos(a) * 3; s.vy = s.vy * 0.4 + Math.sin(a) * 3;
    }
    // Killed by the arena (sun, lava, closing border): no points either way.
    envKill(s, vx, vy) {
      if (s.mode === 's') { this.destroyShip(s, 'env'); s.vx = vx; s.vy = vy; s.invuln = 40; }
      else if (s.mode === 'p') this.eliminate(s, 'env');
    }
    eliminate(s, by, silent) {
      s.mode = 'd'; s.charge = 0; s.beam = 0;
      if (!silent) this.ev({ e: 'elim', id: s.id, by, x: r1(s.x), y: r1(s.y), c: s.color });
      if (this.phase !== 'play') return;
      const victim = this.player(s.id);
      if (by === 'env') return;
      if (by && by !== s.id) {
        const k = this.player(by);
        if (k) { k.score++; this.ev({ e: 'point', id: by, d: 1 }); }
      } else if (victim && victim.score > 0) {
        victim.score--; this.ev({ e: 'point', id: s.id, d: -1 });
      }
    }

    // ---- contacts between ships (ramming pilots, jouster blades, bumping)
    // Live blades as [x, y, bit]. bit 1 = right side, bit 2 = left side.
    bladePoints(s) {
      const px = -Math.sin(s.a), py = Math.cos(s.a), out = [];
      if (s.joust & 1) out.push([s.x + px * C.BLADE_OFF, s.y + py * C.BLADE_OFF, 1]);
      if (s.joust & 2) out.push([s.x - px * C.BLADE_OFF, s.y - py * C.BLADE_OFF, 2]);
      return out;
    }
    shipContacts() {
      const ss = this.ships;
      for (let i = 0; i < ss.length; i++) {
        const a = ss[i]; if (a.mode === 'd') continue;
        // Jouster blades
        if (a.joust > 0 && a.mode === 's') {
          for (const bp of this.bladePoints(a)) {
            for (const o of ss) {
              if (o === a || o.mode === 'd' || o.invuln > 0) continue;
              const r = o.mode === 'p' ? C.PILOT_R : C.SHIP_R;
              if (Math.hypot(o.x - bp[0], o.y - bp[1]) >= r + C.BLADE_R) continue;
              this.ev({ e: 'clang', x: r1(bp[0]), y: r1(bp[1]) });
              if (o.mode === 's' && o.joust > 0 && this.bladePoints(o).some(q => Math.hypot(q[0] - bp[0], q[1] - bp[1]) < C.BLADE_R * 2.2)) {
                const ang = Math.atan2(o.y - a.y, o.x - a.x);
                o.vx = Math.cos(ang) * 5; o.vy = Math.sin(ang) * 5; a.vx = -Math.cos(ang) * 5; a.vy = -Math.sin(ang) * 5;
                continue;
              }
              if (o.mode === 's') { o.shield = 0; this.destroyShip(o, a.id); } else this.eliminate(o, a.id);
            }
            for (const c of this.crates) if (!c.dead && Math.hypot(c.x - bp[0], c.y - bp[1]) < C.CRATE_R + C.BLADE_R) this.breakCrate(c);
          }
          this.crates = this.crates.filter(c => !c.dead);
        }
        for (let j = i + 1; j < ss.length; j++) {
          const b = ss[j]; if (b.mode === 'd' || a.mode === 'd') continue;
          const ra = a.mode === 'p' ? C.PILOT_R : C.SHIP_R, rb = b.mode === 'p' ? C.PILOT_R : C.SHIP_R;
          let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1;
          if (d >= ra + rb) continue;
          // Ships run over pilots
          const ram = (ship, pilot) => {
            if (pilot.meleeT > 0) { // parried: knock the ship away
              const ang = Math.atan2(ship.y - pilot.y, ship.x - pilot.x);
              ship.vx = Math.cos(ang) * 7; ship.vy = Math.sin(ang) * 7;
              this.ev({ e: 'clang', x: r1((ship.x + pilot.x) / 2), y: r1((ship.y + pilot.y) / 2) });
              return true;
            }
            if (pilot.invuln <= 0 && pilot.frozen <= 0) { this.eliminate(pilot, ship.id); return true; }
            return false;
          };
          if (a.mode === 's' && b.mode === 'p' && ram(a, b)) continue;
          if (b.mode === 's' && a.mode === 'p' && ram(b, a)) continue;
          dx /= d; dy /= d;
          const pen = (ra + rb - d) / 2;
          a.x -= dx * pen; a.y -= dy * pen; b.x += dx * pen; b.y += dy * pen;
          const vn = (b.vx - a.vx) * dx + (b.vy - a.vy) * dy;
          if (vn < 0) { a.vx += dx * vn * 0.9; a.vy += dy * vn * 0.9; b.vx -= dx * vn * 0.9; b.vy -= dy * vn * 0.9; this.ev({ e: 'bonk', x: r1(a.x + dx * ra), y: r1(a.y + dy * ra) }); }
        }
      }
    }

    // ---- bullets
    updateBullets() {
      const m = this.map;
      for (const b of this.bullets) {
        if (b.dead) continue;
        if (b.k === 'm') this.steerMissile(b);
        if (m.sun) {
          const dx = m.sun.x - b.x, dy = m.sun.y - b.y, d2 = Math.max(dx * dx + dy * dy, 1600), d = Math.sqrt(d2);
          const f = m.sun.g * 1.4 / d2; b.vx += dx / d * f; b.vy += dy / d * f;
        }
        for (let sub = 0; sub < 2 && !b.dead; sub++) {
          const px = b.x, py = b.y;
          b.x += b.vx / 2; b.y += b.vy / 2;
          this.bulletWorld(b, px, py);
          if (!b.dead) this.bulletHits(b);
        }
        if (!b.dead && --b.life <= 0) { if (b.k === 'm') this.explodeMissile(b); else b.dead = true; }
      }
      this.bullets = this.bullets.filter(b => !b.dead);
      this.crates = this.crates.filter(c => !c.dead);
      this.asteroids = this.asteroids.filter(a => !a.dead);
    }
    steerMissile(b) {
      let best = null, bd = 700;
      for (const s of this.ships) {
        if (s.id === b.owner || s.mode === 'd') continue;
        const d = Math.hypot(s.x - b.x, s.y - b.y); if (d < bd) { bd = d; best = s; }
      }
      let a = Math.atan2(b.vy, b.vx);
      const sp = Math.min(Math.hypot(b.vx, b.vy) + 0.09, 7.2);
      if (best) a += clamp(adiff(Math.atan2(best.y - b.y, best.x - b.x), a), -0.06, 0.06);
      b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
    }
    // Wall / obstacle response for a bullet. Ricochet bullets reflect, the rest die.
    bulletWorld(b, px, py) {
      const m = this.map, R = C.BULLET_R;
      const bounce = (flipX, flipY) => {
        if (b.k === 'b' && b.bounces > 0) {
          b.bounces--; b.hops++; b.x = px; b.y = py;
          if (flipX) b.vx = -b.vx; if (flipY) b.vy = -b.vy;
          this.ev({ e: 'ric', x: r1(b.x), y: r1(b.y) });
          return true;
        }
        if (b.k === 'm') this.explodeMissile(b); else { b.dead = true; this.ev({ e: 'spark', x: r1(b.x), y: r1(b.y), c: b.c }); }
        return true;
      };
      if (b.x < 0 || b.x > W) return bounce(true, false);
      if (b.y < 0 || b.y > H) return bounce(false, true);
      const rectHit = rc => {
        if (!inRect(b.x, b.y, rc, R)) return false;
        const wasInX = px > rc[0] - R && px < rc[0] + rc[2] + R;
        return bounce(!wasInX, wasInX);
      };
      for (const rc of m.walls) if (rectHit(rc)) return;
      for (let i = 0; i < m.blocks.length; i++) {
        if (!this.blocks[i] || !inRect(b.x, b.y, m.blocks[i], R)) continue;
        this.breakBlock(i);
        if (b.k === 'm') { this.explodeMissile(b); return; }
        b.dead = true; return;
      }
      const circ = c => {
        const dx = b.x - c.x, dy = b.y - c.y, d = Math.hypot(dx, dy);
        if (d >= c.r + R) return false;
        if (b.k === 'b' && b.bounces > 0) {
          const nx = dx / d, ny = dy / d, vn = b.vx * nx + b.vy * ny;
          b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny; b.x = px; b.y = py; b.bounces--; b.hops++;
          this.ev({ e: 'ric', x: r1(b.x), y: r1(b.y) });
          return true;
        }
        return bounce(false, false);
      };
      for (const c of m.circles) if (circ(c)) return;
      for (const c of m.bumpers) if (circ(c)) { this.ev({ e: 'bump', x: r1(c.x), y: r1(c.y), q: 1 }); return; }
      if (m.sun && Math.hypot(b.x - m.sun.x, b.y - m.sun.y) < m.sun.r) { b.dead = true; this.ev({ e: 'sizzle', x: r1(b.x), y: r1(b.y) }); return; }
      for (const sp of m.spinners) for (const sg of spinSegs(sp, this.tick)) {
        const q = closestOnSeg(b.x, b.y, sg);
        if (Math.hypot(b.x - q[0], b.y - q[1]) < sp.th / 2 + R) { bounce(false, false); if (b.k === 'b' && !b.dead) { b.vx = -b.vx; b.vy = -b.vy; } return; }
      }
      for (const a of this.asteroids) if (!a.dead && Math.hypot(b.x - a.x, b.y - a.y) < a.r + R) {
        this.splitAsteroid(a);
        if (b.k === 'm') this.explodeMissile(b); else b.dead = true;
        return;
      }
      for (const c of this.crates) if (!c.dead && Math.hypot(b.x - c.x, b.y - c.y) < C.CRATE_R + R) {
        this.breakCrate(c, b.owner);
        if (b.k === 'm') this.explodeMissile(b); else b.dead = true;
        return;
      }
    }
    bulletHits(b) {
      for (const mn of this.mines) if (!mn.dead && mn.owner !== b.owner && Math.hypot(mn.x - b.x, mn.y - b.y) < 12 + C.BULLET_R) {
        this.detonate(mn); if (b.k === 'm') this.explodeMissile(b); else b.dead = true; return;
      }
      if (b.k !== 'm') {
        for (const o of this.bullets) if (o.k === 'm' && !o.dead && o.owner !== b.owner && Math.hypot(o.x - b.x, o.y - b.y) < 12) {
          this.explodeMissile(o); b.dead = true; return;
        }
      }
      for (const s of this.ships) {
        if (s.mode === 'd' || s.invuln > 0) continue;
        if (s.id === b.owner && b.hops === 0) continue;
        const r = s.mode === 'p' ? C.PILOT_HIT : C.SHIP_HIT;
        // Jouster blades swat bullets away
        if (s.joust > 0 && s.mode === 's') {
          const hit = this.bladePoints(s).find(bp => Math.hypot(bp[0] - b.x, bp[1] - b.y) < C.BLADE_R + C.BULLET_R);
          if (hit) {
            if (b.k === 'm') this.explodeMissile(b); else b.dead = true;
            s.joust &= ~hit[2];
            this.ev({ e: 'bladeBreak', id: s.id, x: r1(hit[0]), y: r1(hit[1]) });
            return;
          }
        }
        if (Math.hypot(s.x - b.x, s.y - b.y) >= r) continue;
        if (b.k === 'm') { this.explodeMissile(b); return; }
        b.dead = true;
        this.ev({ e: 'hit', id: s.id, x: r1(b.x), y: r1(b.y), a: r3(Math.atan2(b.vy, b.vx)), c: b.c });
        this.hitShip(s, b.owner, b.k === 'i' ? 'ice' : 'bullet');
        return;
      }
    }
    explodeMissile(b) { if (b.dead) return; b.dead = true; this.explode(b.x, b.y, C.MISSILE_BLAST, b.owner, 'missile'); }

    explode(x, y, r, by, src) {
      this.ev({ e: 'boom', x: r1(x), y: r1(y), r, s: src || 'missile' });
      const m = this.map;
      for (const s of this.ships) {
        if (s.mode === 'd') continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < r + (s.mode === 'p' ? C.PILOT_R : C.SHIP_R)) {
          this.hitShip(s, by, 'blast');
          if (s.mode !== 'd' && d > 1) { s.vx += (s.x - x) / d * 4; s.vy += (s.y - y) / d * 4; }
        }
      }
      for (let i = 0; i < m.blocks.length; i++) if (this.blocks[i]) {
        const rc = m.blocks[i];
        if (Math.hypot(rc[0] + rc[2] / 2 - x, rc[1] + rc[3] / 2 - y) < r + 10) this.breakBlock(i);
      }
      for (const c of this.crates) if (!c.dead && Math.hypot(c.x - x, c.y - y) < r + 16) this.breakCrate(c, by);
      for (const a of this.asteroids) if (!a.dead && Math.hypot(a.x - x, a.y - y) < r + a.r) this.splitAsteroid(a);
      for (const mn of this.mines) if (!mn.dead && Math.hypot(mn.x - x, mn.y - y) < r + 10 && mn.fuse === 0) { mn.arm = 0; mn.fuse = 6; }
      for (const b of this.bullets) if (!b.dead && b.k === 'm' && Math.hypot(b.x - x, b.y - y) < r) { b.dead = true; this.explode(b.x, b.y, C.MISSILE_BLAST, b.owner); }
    }

    // ---- mines
    updateMines() {
      for (const mn of this.mines) {
        if (mn.dead) continue;
        if (mn.arm > 0) { mn.arm--; continue; }
        if (mn.fuse > 0) { if (--mn.fuse === 0) this.detonate(mn); continue; }
        for (const s of this.ships) {
          if (s.mode === 'd' || s.id === mn.owner) continue;
          if (Math.hypot(s.x - mn.x, s.y - mn.y) < C.MINE_TRIGGER) { mn.fuse = C.MINE_FUSE; this.ev({ e: 'beep', x: r1(mn.x), y: r1(mn.y) }); break; }
        }
      }
      this.mines = this.mines.filter(m => !m.dead);
    }
    detonate(mn) { if (mn.dead) return; mn.dead = true; this.explode(mn.x, mn.y, C.MINE_BLAST, mn.owner, 'mine'); }

    // ---- destructibles & pickups
    breakBlock(i) {
      if (!this.blocks[i]) return;
      this.blocks[i] = false;
      const rc = this.map.blocks[i];
      this.ev({ e: 'block', i, x: rc[0] + rc[2] / 2, y: rc[1] + rc[3] / 2 });
      if (Math.random() < 0.08) this.dropItem(rc[0] + rc[2] / 2, rc[1] + rc[3] / 2);
    }
    // Mystery orb: nobody knows what's inside until it's broken open; the powerup then
    // sits there and the first ship to touch it takes it.
    breakCrate(c) {
      if (c.dead) return; c.dead = true;
      const t = pickPower();
      this.ev({ e: 'crate', x: r1(c.x), y: r1(c.y), t });
      this.items.push({ id: this.nextId++, x: c.x, y: c.y, t, life: C.ITEM_LIFE, wait: 24 });
    }
    givePower(s, t, x, y) {
      const P = POWERS[t];
      if (t === 'shield') s.shield = 1;
      else if (t === 'reverse') {
        for (const o of this.ships) if (o !== s && o.mode !== 'd') { o.rev = C.REVERSE; o.a = wrapA(o.a + PI); o.vx *= -0.7; o.vy *= -0.7; }
        this.ev({ e: 'reverse', id: s.id });
      } else { s.power = t; s.uses = P.uses; }
      this.ev({ e: 'pick', id: s.id, t, x: r1(x), y: r1(y) });
    }
    spawnCrate(x, y, fixed) {
      const a = rnd(0, TAU), sp = fixed ? 0 : C.CRATE_SPEED;
      this.crates.push({ id: this.nextId++, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, fixed: !!fixed });
    }
    dropItem(x, y) { if (this.crates.length < C.CRATE_MAX + 2) this.spawnCrate(x, y); }
    updateCrates() {
      for (const c of this.crates) {
        if (c.fixed) continue;
        c.x += c.vx; c.y += c.vy;
        const before = Math.hypot(c.vx, c.vy) || C.CRATE_SPEED;
        collideWorld(c, C.CRATE_R, { map: this.map, blocks: this.blocks, asteroids: [], tick: this.tick, canMove: true });
        // keep a steady drift after bouncing
        const now = Math.hypot(c.vx, c.vy) || 1;
        c.vx *= before / now; c.vy *= before / now;
        if (this.inHazard(c.x, c.y, 0)) { c.vx = -c.vx; c.vy = -c.vy; c.x += c.vx * 3; c.y += c.vy * 3; }
      }
    }
    splitAsteroid(a, shatter) {
      if (a.dead) return; a.dead = true;
      this.ev({ e: 'rock', x: r1(a.x), y: r1(a.y), r: a.r });
      if (a.r > 20 && !shatter) {
        const base = Math.atan2(a.vy, a.vx) + PI / 2, sp = Math.hypot(a.vx, a.vy) + 0.5;
        for (const s of [-1, 1]) {
          const n = this.newAsteroid(a.x + Math.cos(base) * s * a.r * 0.4, a.y + Math.sin(base) * s * a.r * 0.4, Math.round(a.r * 0.62), base + (s < 0 ? PI : 0), sp);
          this.asteroids.push(n);
        }
      } else if (Math.random() < 0.25) this.dropItem(a.x, a.y);
    }
    updateAsteroids() {
      if (!this.map.asteroids.length) return;
      for (const a of this.asteroids) {
        a.x += a.vx; a.y += a.vy; a.a += a.va;
        const sp = Math.hypot(a.vx, a.vy);
        if (sp > 2.2) { a.vx *= 0.98; a.vy *= 0.98; }
        if (a.x < a.r) { a.x = a.r; a.vx = Math.abs(a.vx); }
        if (a.x > W - a.r) { a.x = W - a.r; a.vx = -Math.abs(a.vx); }
        if (a.y < a.r) { a.y = a.r; a.vy = Math.abs(a.vy); }
        if (a.y > H - a.r) { a.y = H - a.r; a.vy = -Math.abs(a.vy); }
        for (let i = 0; i < this.map.blocks.length; i++) if (this.blocks[i]) pushRect(a, a.r, this.map.blocks[i]);
      }
      // Keep the belt populated
      if (this.tick % 480 === 0 && this.asteroids.reduce((n, a) => n + a.r * a.r, 0) < 3 * 42 * 42) {
        const left = Math.random() < 0.5;
        this.asteroids.push(this.newAsteroid(left ? 50 : W - 50, rnd(150, H - 150), 42, left ? rnd(-0.5, 0.5) : PI + rnd(-0.5, 0.5), 0.9));
      }
    }
    updateItems(live) {
      for (const it of this.items) {
        if (--it.life <= 0) { it.dead = true; continue; }
        if (it.wait > 0) { it.wait--; continue; }
        for (const s of this.ships) {
          if (s.mode !== 's' || Math.hypot(s.x - it.x, s.y - it.y) > 40) continue;
          it.dead = true;
          this.givePower(s, it.t, it.x, it.y);
          break;
        }
      }
      this.items = this.items.filter(i => !i.dead);
      // Ramming a box opens it
      this.updateCrates();
      for (const c of this.crates) for (const s of this.ships) {
        if (c.dead || c.fixed || s.mode === 'd') continue;
        const dx = c.x - s.x, dy = c.y - s.y, d = Math.hypot(dx, dy) || 1, min = (s.mode === 's' ? C.SHIP_R : C.PILOT_R) + C.CRATE_R;
        if (d < min + 2) { c.vx = dx / d * C.CRATE_SPEED; c.vy = dy / d * C.CRATE_SPEED; }
      }
      this.crates = this.crates.filter(c => !c.dead);
      if (!live || this.sudden) return;
      if (--this.crateT <= 0) {
        this.crateT = C.CRATE_EVERY;
        const v = this.map.vault;
        if (v && !this.crates.some(c => c.x === v.x && c.y === v.y) && !this.items.some(i => Math.hypot(i.x - v.x, i.y - v.y) < 5)) {
          this.spawnCrate(v.x, v.y, true);
        } else if (this.crates.length < C.CRATE_MAX) {
          const p = this.freeSpot(30);
          if (p) { this.spawnCrate(p.x, p.y); this.ev({ e: 'crateIn', x: r1(p.x), y: r1(p.y) }); }
        }
      }
    }

    // ---- spatial queries
    solidAt(x, y, pad, bot, shootable) {
      if (x < pad || y < pad || x > W - pad || y > H - pad) return true;
      const m = this.map;
      for (const rc of m.walls) if (inRect(x, y, rc, pad)) return true;
      if (!shootable) for (let i = 0; i < m.blocks.length; i++) if (this.blocks[i] && inRect(x, y, m.blocks[i], pad)) return true;
      for (const c of m.circles) if (Math.hypot(x - c.x, y - c.y) < c.r + pad) return true;
      for (const c of m.bumpers) if (Math.hypot(x - c.x, y - c.y) < c.r + pad) return true;
      if (m.sun && Math.hypot(x - m.sun.x, y - m.sun.y) < m.sun.r + pad + (bot ? 30 : 0)) return true;
      for (const sp of m.spinners) for (const sg of spinSegs(sp, this.tick)) {
        const q = closestOnSeg(x, y, sg); if (Math.hypot(x - q[0], y - q[1]) < sp.th / 2 + pad) return true;
      }
      if (bot) {
        for (const a of this.asteroids) if (Math.hypot(x - a.x, y - a.y) < a.r + pad) return true;
        if (this.inHazard(x, y, pad + 12)) return true;
        if (this.shrink > 0) { const mx = this.shrink + pad + 30, my = mx * H / W; if (x < mx || x > W - mx || y < my || y > H - my) return true; }
      }
      return false;
    }
    clearLine(x0, y0, x1, y1) {
      const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 14);
      for (let i = 2; i < n; i++) { const t = i / n; if (this.solidAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 2, false, true)) return false; }
      return true;
    }
    freeSpot(pad) {
      for (let k = 0; k < 80; k++) {
        const x = rnd(90, W - 90), y = rnd(90, H - 90);
        if (this.solidAt(x, y, pad, true)) continue;
        if (this.map.spinners.some(sp => Math.hypot(x - sp.x, y - sp.y) < sp.len / 2 + pad)) continue;
        if (this.ships.some(s => s.mode !== 'd' && Math.hypot(s.x - x, s.y - y) < 110)) continue;
        if (this.crates.some(c => Math.hypot(c.x - x, c.y - y) < 120)) continue;
        return { x, y };
      }
      return null;
    }

    // ---- network/render view
    snapshot() {
      return {
        f: this.frame, t: this.tick, ph: this.phase, pt: this.phaseT, rd: this.round, map: this.map.id, sd: this.sudden ? 1 : 0,
        tg: this.settings.target, rw: this.roundWinner, mw: this.matchWinner, sk: r1(this.shrink),
        pl: this.players.map(p => ({ id: p.id, n: p.name, c: p.color, s: p.score, p: p.prev, b: p.bot ? 1 : 0 })),
        bk: this.blocks.map(b => (b ? 1 : 0)).join(''),
        sh: this.ships.map(s => ({
          id: s.id, c: s.color, x: r1(s.x), y: r1(s.y), a: r3(s.a), vx: r3(s.vx), vy: r3(s.vy), m: s.mode,
          am: s.ammo, rl: r3(s.reload / C.RELOAD), pw: s.power, pu: s.uses, sd: s.shield, jo: s.joust, fr: s.frozen,
          ch: s.charge, bm: s.beam, bx: r1(s.bx), by: r1(s.by), iv: s.invuln, rs: s.respawn, dc: s.dashCd, dt: s.dashT, rv: s.rev, fc: s.fireCd, ho: s.hold, mt: s.meleeT,
        })),
        bu: this.bullets.map(b => ({ id: b.id, x: r1(b.x), y: r1(b.y), vx: r3(b.vx), vy: r3(b.vy), k: b.k, o: b.owner, c: b.c })),
        mi: this.mines.map(m => ({ id: m.id, x: r1(m.x), y: r1(m.y), c: m.c, ar: m.arm, fu: m.fuse, o: m.owner })),
        it: this.items.map(i => ({ id: i.id, x: r1(i.x), y: r1(i.y), t: i.t, l: i.life, w: i.wait || 0 })),
        cr: this.crates.map(c => ({ id: c.id, x: r1(c.x), y: r1(c.y) })),
        as: this.asteroids.map(a => ({ id: a.id, x: r1(a.x), y: r1(a.y), r: a.r, a: r3(a.a), vx: r3(a.vx), vy: r3(a.vy) })),
      };
    }
  }

  function inRect(x, y, rc, pad) { return x > rc[0] - pad && x < rc[0] + rc[2] + pad && y > rc[1] - pad && y < rc[1] + rc[3] + pad; }

  // Converts a snapshot ship (short keys) into the long-key form moveShip expects.
  function shipFromSnap(s) {
    return { id: s.id, x: s.x, y: s.y, a: s.a, vx: s.vx, vy: s.vy, mode: s.m, dashCd: s.dc, dashT: s.dt, frozen: s.fr, charge: s.ch, beam: s.bm, joust: s.jo, rev: s.rv || 0, hold: s.ho || 0, tapRel: 0 };
  }

  return { W, H, TAU, TICK_MS, C, COLORS, COLOR_NAMES, MAX_PLAYERS, POWERS, POWER_LIST, MAPS, MAP_BY_ID, LEVELS,
    CELL, GC, GR, GRID_CHARS, THEME_IDS, buildGridMap, registerMap, validateMapDef,
    Game, Brain, moveShip, collideWorld, spinSegs, shipFromSnap, adiff, wrapA };
});
