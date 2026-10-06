// Canvas renderer: arena, ships, effects, and between-round overlays.
const FONT = '"Russo One", "Arial Black", sans-serif';

class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.shake = 0; this.flash = 0; this.flashColor = '#fff';
    this.time = 0;
    this.glows = {};
    this.mapCache = null; this.mapCacheKey = '';
    this.bumpT = {};
    this.suddenAt = -99;
    this.lastCount = -1;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    const w = innerWidth, h = innerHeight;
    this.cv.width = Math.round(w * this.dpr); this.cv.height = Math.round(h * this.dpr);
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    // In-game, keep the HUD off the arena: use side margins when wide enough, else a top band.
    let top = 0;
    if (this.hud) {
      const side = (w - h * SP.W / SP.H) / 2 >= 104;
      document.body.dataset.hud = side ? 'side' : 'top';
      if (!side) top = 42;
    } else delete document.body.dataset.hud;
    this.scale = Math.min(w / SP.W, (h - top) / SP.H);
    this.ox = (w - SP.W * this.scale) / 2; this.oy = top + (h - top - SP.H * this.scale) / 2;
    this.mapCacheKey = '';
  }
  setHud(on) { this.hud = on; this.resize(); }

  glow(color) {
    if (this.glows[color]) return this.glows[color];
    if (color.length === 4) return (this.glows[color] = this.glow('#' + [...color.slice(1)].map(ch => ch + ch).join('')));
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, color + 'cc'); grd.addColorStop(0.35, color + '55'); grd.addColorStop(1, color + '00');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return (this.glows[color] = c);
  }

  // ------------------------------------------------------------ particles
  add(p) { if (this.parts.length < 900) this.parts.push(p); }
  burst(x, y, color, n, speed, life, size, kind = 'spark') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * SP.TAU, s = speed * (0.3 + Math.random() * 0.9);
      this.add({ k: kind, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.5 + Math.random() * 0.7), max: life, size: size * (0.6 + Math.random() * 0.8), c: color, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4 });
    }
  }
  ring(x, y, color, r0, r1, life, w = 3) { this.add({ k: 'ring', x, y, r0, r1, life, max: life, c: color, w }); }
  text(x, y, str, color, size = 22) { this.add({ k: 'text', x, y, vx: 0, vy: -0.8, life: 1.1, max: 1.1, c: color, s: str, size }); }
  bump(amount) { if (!this.silent) this.shake = Math.max(this.shake, amount); }
  snd(name) { if (!this.silent) Sfx.play(name); }

  // Spawns effects for a simulation event. `fr` is the current render frame, `me` local player ids.
  fx(e, fr, mine) {
    const ship = e.id != null ? fr.sh.find(s => s.id === e.id) : null;
    const col = e.c || (ship && ship.c) || '#fff';
    switch (e.e) {
      case 'shot':
        if (ship) {
          const ca = Math.cos(ship.a), sa = Math.sin(ship.a);
          this.burst(ship.x + ca * 20, ship.y + sa * 20, '#fff', 4, 3, 0.12, 2);
          this.add({ k: 'flash', x: ship.x + ca * 20, y: ship.y + sa * 20, life: 0.08, max: 0.08, c: ship.c, size: 22 });
        }
        this.snd(e.k === 't' ? 'triple' : e.k === 'm' ? 'missile' : e.k === 'i' ? 'ice' : 'shot');
        break;
      case 'dry': if (mine) this.snd('dry'); break;
      case 'kill': {
        this.burst(e.x, e.y, col, 26, 6, 0.7, 3);
        this.burst(e.x, e.y, '#fff', 12, 8, 0.35, 2);
        this.burst(e.x, e.y, '#ffb347', 14, 4, 0.6, 3);
        for (let i = 0; i < 7; i++) {
          const a = Math.random() * SP.TAU, s = 1.5 + Math.random() * 3;
          this.add({ k: 'shard', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1.2, max: 1.2, c: col, size: 6 + Math.random() * 8, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.5 });
        }
        for (let i = 0; i < 6; i++) this.add({ k: 'smoke', x: e.x, y: e.y, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2, life: 0.9, max: 0.9, size: 10 + Math.random() * 10 });
        this.ring(e.x, e.y, col, 10, 80, 0.4, 4);
        this.add({ k: 'flash', x: e.x, y: e.y, life: 0.15, max: 0.15, c: '#fff', size: 120 });
        this.bump(mine ? 16 : 10);
        this.snd('kill');
        if (mine && !this.silent && navigator.vibrate) navigator.vibrate(120);
        break;
      }
      case 'elim':
        this.burst(e.x, e.y, col, 18, 4, 0.6, 3, 'dot');
        this.ring(e.x, e.y, '#fff', 4, 50, 0.35, 3);
        this.text(e.x, e.y - 20, '✖', col, 26);
        this.bump(6);
        this.snd('elim');
        if (mine && !this.silent && navigator.vibrate) navigator.vibrate([60, 40, 160]);
        break;
      case 'boom':
        this.burst(e.x, e.y, '#ffb347', 30, 7, 0.6, 4);
        this.burst(e.x, e.y, '#ff4766', 18, 5, 0.7, 3);
        this.burst(e.x, e.y, '#fff', 10, 9, 0.25, 2);
        for (let i = 0; i < 8; i++) this.add({ k: 'smoke', x: e.x + (Math.random() - 0.5) * 30, y: e.y + (Math.random() - 0.5) * 30, vx: (Math.random() - 0.5) * 1.5, vy: (Math.random() - 0.5) * 1.5, life: 1.1, max: 1.1, size: 14 + Math.random() * 16 });
        this.ring(e.x, e.y, '#ffb347', 10, e.r, 0.35, 6);
        this.add({ k: 'flash', x: e.x, y: e.y, life: 0.18, max: 0.18, c: '#ffd9a0', size: e.r * 2.2 });
        this.bump(14);
        this.snd('boom');
        break;
      case 'block':
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * SP.TAU, s = 1 + Math.random() * 3;
          this.add({ k: 'shard', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.7, max: 0.7, c: '#ffb347', size: 5 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.5, sq: 1 });
        }
        this.burst(e.x, e.y, '#ffcf80', 6, 3, 0.3, 2);
        this.snd('block');
        break;
      case 'rock':
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * SP.TAU, s = 1 + Math.random() * 3;
          this.add({ k: 'shard', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.9, max: 0.9, c: '#9aa3d6', size: e.r * 0.2 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, sq: 1 });
        }
        this.snd('block');
        break;
      case 'crate':
        this.burst(e.x, e.y, '#ffd23f', 16, 4, 0.5, 3);
        this.ring(e.x, e.y, '#ffd23f', 6, 40, 0.3, 3);
        this.snd('crate');
        break;
      case 'crateIn': this.ring(e.x, e.y, '#ffd23f', 40, 8, 0.4, 2); break;
      case 'pick': {
        const P = SP.POWERS[e.t];
        this.ring(e.x, e.y, P.color, 8, 46, 0.35, 4);
        this.burst(e.x, e.y, P.color, 12, 3, 0.4, 2);
        this.text(e.x, e.y - 26, P.name, P.color, 18);
        this.snd('pick');
        break;
      }
      case 'spark': this.burst(e.x, e.y, col, 5, 2.5, 0.2, 2); break;
      case 'ric': this.burst(e.x, e.y, '#4dff88', 5, 3, 0.2, 2); this.snd('ric'); break;
      case 'bump': {
        const m = fr.map; let bi = 0, bd = 1e9;
        m.bumpers.forEach((b, i) => { const d = Math.hypot(b.x - e.x, b.y - e.y); if (d < bd) { bd = d; bi = i; } });
        this.bumpT[bi] = this.time;
        if (!e.q) { this.snd('bump'); this.burst(e.x, e.y, '#ff4dd8', 6, 3, 0.25, 2); }
        break;
      }
      case 'bonk': this.burst(e.x, e.y, '#fff', 4, 2, 0.2, 2); this.snd('bonk'); break;
      case 'freeze': this.burst(e.x, e.y, '#bff6ff', 16, 3, 0.5, 3, 'dot'); this.ring(e.x, e.y, '#7fe9ff', 6, 40, 0.3, 3); this.snd('freeze'); break;
      case 'shatter':
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * SP.TAU, s = 2 + Math.random() * 4;
          this.add({ k: 'shard', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.8, max: 0.8, c: '#bff6ff', size: 4 + Math.random() * 8, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.6 });
        }
        this.bump(8); this.snd('shatter');
        break;
      case 'shieldPop': this.ring(e.x, e.y, '#3fa9ff', 20, 60, 0.35, 4); this.burst(e.x, e.y, '#9fd4ff', 14, 4, 0.4, 2); this.snd('shield'); break;
      case 'clang': this.burst(e.x, e.y, '#fff', 8, 4, 0.2, 2); this.snd('clang'); break;
      case 'beep': this.snd('beep'); break;
      case 'drop': this.snd('drop'); break;
      case 'dash':
        if (ship) { for (let i = 0; i < 8; i++) this.add({ k: 'dot', x: ship.x + (Math.random() - 0.5) * 10, y: ship.y + (Math.random() - 0.5) * 10, vx: -Math.cos(ship.a) * 2, vy: -Math.sin(ship.a) * 2, life: 0.35, max: 0.35, c: ship.c, size: 3 }); }
        this.snd('dash');
        break;
      case 'charge': this.snd('charge'); break;
      case 'laser': this.bump(9); this.snd('laser'); break;
      case 'respawn': this.ring(e.x, e.y, col, 50, 10, 0.4, 3); this.ring(e.x, e.y, '#fff', 10, 40, 0.3, 2); this.snd('respawn'); break;
      case 'sizzle': this.burst(e.x, e.y, '#ffb347', 4, 2, 0.3, 2); this.snd('sizzle'); break;
      case 'go': this.snd('go'); break;
      case 'sudden': this.suddenAt = this.time; this.snd('sudden'); break;
      case 'roundWin': this.snd(e.id ? 'roundWin' : 'lose'); break;
      case 'point': {
        const s = fr.sh.find(q => q.id === e.id);
        if (s) this.text(s.x, s.y - 30, e.d > 0 ? '+1' : '−1', e.d > 0 ? '#fff' : '#ff4766', 24);
        if (e.d > 0) this.snd('point');
        break;
      }
      case 'matchWin': {
        this.snd('matchWin');
        const p = fr.pl.find(q => q.id === e.id);
        for (let i = 0; i < 140; i++) {
          this.add({ k: 'confetti', x: Math.random() * SP.W, y: -20 - Math.random() * 300, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3, life: 5, max: 5, c: Math.random() < 0.5 && p ? p.c : SP.COLORS[(Math.random() * 6) | 0], size: 5 + Math.random() * 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3 });
        }
        break;
      }
    }
  }

  stepParticles(dt) {
    const k = dt * 60;
    for (const p of this.parts) {
      p.life -= dt;
      if (p.k === 'ring' || p.k === 'flash') continue;
      p.x += p.vx * k; p.y += p.vy * k;
      if (p.k === 'confetti') { p.vx += Math.sin(this.time * 3 + p.rot) * 0.02; p.rot += p.vr * k; continue; }
      const drag = p.k === 'smoke' ? 0.96 : 0.93;
      p.vx *= Math.pow(drag, k); p.vy *= Math.pow(drag, k);
      if (p.rot !== undefined) p.rot += p.vr * k;
    }
    this.parts = this.parts.filter(p => p.life > 0);
  }

  // ------------------------------------------------------------ static map layer
  buildMapCache(map) {
    const s = this.scale * this.dpr;
    const c = document.createElement('canvas');
    c.width = Math.ceil(SP.W * s); c.height = Math.ceil(SP.H * s);
    const g = c.getContext('2d');
    g.scale(s, s);
    const bg = g.createRadialGradient(SP.W / 2, SP.H / 2, 100, SP.W / 2, SP.H / 2, 800);
    bg.addColorStop(0, '#0d1130'); bg.addColorStop(1, '#05060f');
    g.fillStyle = bg; g.fillRect(0, 0, SP.W, SP.H);
    g.strokeStyle = 'rgba(110,130,255,0.06)'; g.lineWidth = 1;
    for (let x = 40; x < SP.W; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, SP.H); g.stroke(); }
    for (let y = 40; y < SP.H; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(SP.W, y); g.stroke(); }
    let seed = 0; for (const ch of map.id) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(255,255,255,${0.15 + rand() * 0.6})`;
      const r = rand() * 1.4 + 0.3;
      g.beginPath(); g.arc(rand() * SP.W, rand() * SP.H, r, 0, SP.TAU); g.fill();
    }
    g.shadowColor = '#3f6bff'; g.shadowBlur = 16;
    g.strokeStyle = '#3d55c9'; g.lineWidth = 4;
    g.strokeRect(2, 2, SP.W - 4, SP.H - 4);
    g.shadowColor = '#45c8ff'; g.shadowBlur = 14;
    for (const w of map.walls) {
      g.fillStyle = '#101634'; g.strokeStyle = '#45c8ff'; g.lineWidth = 2.5;
      roundRect(g, w[0], w[1], w[2], w[3], 4); g.fill(); g.stroke();
    }
    for (const c2 of map.circles) {
      g.fillStyle = '#101634'; g.strokeStyle = '#45c8ff'; g.lineWidth = 3;
      g.beginPath(); g.arc(c2.x, c2.y, c2.r, 0, SP.TAU); g.fill(); g.stroke();
    }
    g.shadowBlur = 0;
    for (const w of map.walls) {
      g.strokeStyle = 'rgba(69,200,255,0.25)'; g.lineWidth = 1;
      roundRect(g, w[0] + 4, w[1] + 4, w[2] - 8, w[3] - 8, 2); if (w[2] > 10 && w[3] > 10) g.stroke();
    }
    return c;
  }

  // ------------------------------------------------------------ main draw
  draw(fr, dt, opts = {}) {
    this.time += dt;
    const g = this.ctx, d = this.dpr;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#03040b'; g.fillRect(0, 0, this.cv.width, this.cv.height);
    if (!fr) return;
    const map = fr.map;
    const key = map.id + '@' + this.scale;
    if (key !== this.mapCacheKey) { this.mapCache = this.buildMapCache(map); this.mapCacheKey = key; }

    this.shake *= Math.pow(0.002, dt);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    const s = this.scale * d;
    g.setTransform(s, 0, 0, s, (this.ox + sx * this.scale) * d, (this.oy + sy * this.scale) * d);
    g.drawImage(this.mapCache, 0, 0, SP.W, SP.H);
    g.save(); g.beginPath(); g.rect(0, 0, SP.W, SP.H); g.clip();

    this.drawDynamicMap(g, fr);
    this.drawPickups(g, fr);
    this.drawBullets(g, fr);
    for (const sh of fr.sh) if (sh.m !== 'd') this.drawBeam(g, sh);
    for (const sh of fr.sh) if (sh.m === 'p') this.drawPilot(g, sh, fr);
    for (const sh of fr.sh) if (sh.m === 's') this.drawShip(g, sh, fr);
    this.engineTrails(fr, dt);
    this.stepParticles(dt);
    this.drawParticles(g);
    this.drawLabels(g, fr, opts);
    g.restore();

    g.setTransform(s, 0, 0, s, this.ox * d, this.oy * d);
    if (this.flash > 0) { this.flash -= dt; }
    this.drawOverlay(g, fr, opts);
  }

  drawDynamicMap(g, fr) {
    const map = fr.map, t = this.time;
    // destructible blocks
    for (let i = 0; i < map.blocks.length; i++) {
      if (fr.bk[i] !== '1') continue;
      const b = map.blocks[i];
      g.fillStyle = '#2b1d0e'; g.fillRect(b[0] + 1, b[1] + 1, b[2] - 2, b[3] - 2);
      g.strokeStyle = '#ffb347'; g.lineWidth = 2; g.strokeRect(b[0] + 2, b[1] + 2, b[2] - 4, b[3] - 4);
      g.strokeStyle = 'rgba(255,179,71,0.35)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(b[0] + 7, b[1] + 7); g.lineTo(b[0] + b[2] - 7, b[1] + b[3] - 7); g.stroke();
    }
    // sun
    if (map.sun) {
      const S = map.sun, pulse = 1 + Math.sin(t * 3) * 0.04;
      g.globalCompositeOperation = 'lighter';
      g.drawImage(this.glow('#ff8c2e'), S.x - S.r * 4, S.y - S.r * 4, S.r * 8, S.r * 8);
      g.globalCompositeOperation = 'source-over';
      for (let i = 0; i < 3; i++) {
        g.strokeStyle = `rgba(255,140,46,${0.08 - i * 0.02})`; g.lineWidth = 1;
        g.beginPath(); g.arc(S.x, S.y, S.r * (2.2 + i * 1.3) + ((t * 20) % 40), 0, SP.TAU); g.stroke();
      }
      const grd = g.createRadialGradient(S.x, S.y, 0, S.x, S.y, S.r * pulse);
      grd.addColorStop(0, '#fff7d6'); grd.addColorStop(0.5, '#ffd23f'); grd.addColorStop(1, '#ff6a00');
      g.fillStyle = grd; g.beginPath(); g.arc(S.x, S.y, S.r * pulse, 0, SP.TAU); g.fill();
      g.strokeStyle = 'rgba(255,220,120,0.6)'; g.lineWidth = 2;
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * SP.TAU + t * 0.4, l = S.r + 8 + Math.sin(t * 5 + i * 2) * 5;
        g.beginPath(); g.moveTo(S.x + Math.cos(a) * (S.r + 3), S.y + Math.sin(a) * (S.r + 3)); g.lineTo(S.x + Math.cos(a) * l, S.y + Math.sin(a) * l); g.stroke();
      }
    }
    // spinners
    for (const sp of map.spinners) {
      g.lineCap = 'round';
      for (const sg of SP.spinSegs(sp, fr.t)) {
        g.strokeStyle = '#45c8ff'; g.lineWidth = sp.th;
        g.beginPath(); g.moveTo(sg[0], sg[1]); g.lineTo(sg[2], sg[3]); g.stroke();
        g.strokeStyle = '#101634'; g.lineWidth = sp.th - 5;
        g.beginPath(); g.moveTo(sg[0], sg[1]); g.lineTo(sg[2], sg[3]); g.stroke();
      }
      g.lineCap = 'butt';
    }
    for (const c of map.circles) {
      g.fillStyle = '#101634'; g.strokeStyle = '#45c8ff'; g.lineWidth = 3;
      g.beginPath(); g.arc(c.x, c.y, c.r, 0, SP.TAU); g.fill(); g.stroke();
    }
    // bumpers
    map.bumpers.forEach((b, i) => {
      const k = Math.max(0, 1 - (this.time - (this.bumpT[i] ?? -9)) * 5);
      const r = b.r * (1 + k * 0.15);
      g.globalCompositeOperation = 'lighter';
      g.drawImage(this.glow('#ff4dd8'), b.x - r * 2.2, b.y - r * 2.2, r * 4.4, r * 4.4);
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = k > 0 ? '#ff9be9' : '#2a0f2a';
      g.beginPath(); g.arc(b.x, b.y, r, 0, SP.TAU); g.fill();
      g.strokeStyle = '#ff4dd8'; g.lineWidth = 4; g.stroke();
      g.strokeStyle = 'rgba(255,77,216,0.5)'; g.lineWidth = 2;
      g.beginPath(); g.arc(b.x, b.y, r * 0.55, 0, SP.TAU); g.stroke();
    });
    // asteroids
    for (const a of fr.as) {
      g.save(); g.translate(a.x, a.y); g.rotate(a.a);
      g.fillStyle = '#1d2140'; g.strokeStyle = '#8f9ad8'; g.lineWidth = 2.5;
      g.beginPath();
      const n = 9;
      for (let i = 0; i < n; i++) {
        const ang = i / n * SP.TAU, rr = a.r * (0.82 + 0.18 * Math.sin(a.id * 7 + i * 2.3));
        i ? g.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr) : g.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      g.closePath(); g.fill(); g.stroke();
      g.fillStyle = 'rgba(143,154,216,0.18)';
      g.beginPath(); g.arc(a.r * 0.25, -a.r * 0.2, a.r * 0.22, 0, SP.TAU); g.fill();
      g.beginPath(); g.arc(-a.r * 0.3, a.r * 0.3, a.r * 0.14, 0, SP.TAU); g.fill();
      g.restore();
    }
  }

  drawPickups(g, fr) {
    const t = this.time;
    for (const c of fr.cr) {
      const bob = Math.sin(t * 3 + c.id) * 2;
      g.save(); g.translate(c.x, c.y + bob); g.rotate(Math.sin(t * 2 + c.id) * 0.15);
      g.globalCompositeOperation = 'lighter';
      g.drawImage(this.glow('#ffd23f'), -34, -34, 68, 68);
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#3a2c06'; g.strokeStyle = '#ffd23f'; g.lineWidth = 2.5;
      roundRect(g, -14, -14, 28, 28, 4); g.fill(); g.stroke();
      g.fillStyle = '#ffd23f'; g.font = `18px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('?', 0, 1);
      g.restore();
    }
    for (const it of fr.it) {
      if (it.l < 180 && Math.floor(t * 8) % 2) continue;
      const P = SP.POWERS[it.t], bob = Math.sin(t * 4 + it.id) * 3;
      g.save(); g.translate(it.x, it.y + bob);
      g.globalCompositeOperation = 'lighter';
      g.drawImage(this.glow(P.color), -36, -36, 72, 72);
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#0b0d1c'; g.strokeStyle = P.color; g.lineWidth = 2.5;
      g.beginPath(); g.arc(0, 0, 15, 0, SP.TAU); g.fill(); g.stroke();
      g.rotate(Math.sin(t * 2) * 0.2);
      drawPowerIcon(g, it.t, 9, P.color);
      g.restore();
    }
    for (const m of fr.mi) {
      const armed = m.ar <= 0, lit = m.fu > 0 ? Math.floor(t * 20) % 2 : Math.floor(t * 2) % 2;
      g.save(); g.translate(m.x, m.y);
      if (m.fu > 0) {
        g.strokeStyle = 'rgba(255,71,102,0.35)'; g.lineWidth = 2; g.setLineDash([6, 6]);
        g.beginPath(); g.arc(0, 0, SP.C.MINE_BLAST, 0, SP.TAU); g.stroke(); g.setLineDash([]);
      }
      g.globalAlpha = armed ? 1 : 0.5;
      g.strokeStyle = m.c; g.lineWidth = 2.5;
      for (let i = 0; i < 8; i++) { const a = i / 8 * SP.TAU + t; g.beginPath(); g.moveTo(Math.cos(a) * 9, Math.sin(a) * 9); g.lineTo(Math.cos(a) * 14, Math.sin(a) * 14); g.stroke(); }
      g.fillStyle = '#16182a'; g.beginPath(); g.arc(0, 0, 10, 0, SP.TAU); g.fill(); g.stroke();
      g.fillStyle = m.fu > 0 ? (lit ? '#ff4766' : '#ffffff') : (lit && armed ? m.c : '#555');
      g.beginPath(); g.arc(0, 0, 4, 0, SP.TAU); g.fill();
      g.restore();
    }
  }

  drawBullets(g, fr) {
    g.lineCap = 'round';
    for (const b of fr.bu) {
      if (b.k === 'm') {
        const a = Math.atan2(b.vy, b.vx);
        g.save(); g.translate(b.x, b.y); g.rotate(a);
        g.globalCompositeOperation = 'lighter';
        g.drawImage(this.glow('#ff8c2e'), -26, -26, 52, 52);
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = '#fff'; g.strokeStyle = b.c; g.lineWidth = 2;
        g.beginPath(); g.moveTo(9, 0); g.lineTo(-6, -5); g.lineTo(-6, 5); g.closePath(); g.fill(); g.stroke();
        g.restore();
        if (Math.random() < 0.7) this.add({ k: 'smoke', x: b.x - Math.cos(a) * 8, y: b.y - Math.sin(a) * 8, vx: 0, vy: 0, life: 0.45, max: 0.45, size: 5 });
        continue;
      }
      if (b.k === 'i') {
        g.save(); g.translate(b.x, b.y); g.rotate(this.time * 8);
        g.globalCompositeOperation = 'lighter';
        g.drawImage(this.glow('#7fe9ff'), -22, -22, 44, 44);
        g.globalCompositeOperation = 'source-over';
        g.strokeStyle = '#dffbff'; g.lineWidth = 2;
        for (let i = 0; i < 3; i++) { g.rotate(Math.PI / 3); g.beginPath(); g.moveTo(-7, 0); g.lineTo(7, 0); g.stroke(); }
        g.restore();
        continue;
      }
      const c = b.k === 'b' ? '#4dff88' : b.c;
      g.globalCompositeOperation = 'lighter';
      g.drawImage(this.glow(c), b.x - 14, b.y - 14, 28, 28);
      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = c; g.lineWidth = 6;
      g.beginPath(); g.moveTo(b.x - b.vx * 1.4, b.y - b.vy * 1.4); g.lineTo(b.x, b.y); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(b.x - b.vx * 0.7, b.y - b.vy * 0.7); g.lineTo(b.x, b.y); g.stroke();
    }
    g.lineCap = 'butt';
  }

  drawBeam(g, s) {
    if (s.ch > 0) {
      // Charging telegraph: thin wavering aim line, gets brighter as it charges.
      const k = 1 - s.ch / SP.C.LASER_CHARGE;
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      g.strokeStyle = s.c; g.globalAlpha = 0.2 + k * 0.6; g.lineWidth = 1 + k * 2;
      g.setLineDash([10, 8]); g.lineDashOffset = -this.time * 80;
      g.beginPath(); g.moveTo(s.x + ca * 20, s.y + sa * 20); g.lineTo(s.x + ca * 1600, s.y + sa * 1600); g.stroke();
      g.setLineDash([]); g.globalAlpha = 1;
      g.globalCompositeOperation = 'lighter';
      const r = 8 + k * 22;
      g.drawImage(this.glow(s.c), s.x + ca * 20 - r, s.y + sa * 20 - r, r * 2, r * 2);
      g.globalCompositeOperation = 'source-over';
    }
    if (s.bm > 0) {
      const ca = Math.cos(s.a), sa = Math.sin(s.a), x0 = s.x + ca * 18, y0 = s.y + sa * 18;
      const wob = 1 + Math.random() * 0.3, fade = Math.min(1, s.bm / 5);
      g.lineCap = 'round';
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = s.c; g.globalAlpha = 0.45 * fade; g.lineWidth = 26 * wob;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(s.bx, s.by); g.stroke();
      g.globalAlpha = 0.9 * fade; g.lineWidth = 12 * wob;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(s.bx, s.by); g.stroke();
      g.globalCompositeOperation = 'source-over';
      g.strokeStyle = '#fff'; g.globalAlpha = fade; g.lineWidth = 5;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(s.bx, s.by); g.stroke();
      g.globalAlpha = 1; g.lineCap = 'butt';
      if (Math.random() < 0.8) this.burst(s.bx, s.by, s.c, 2, 4, 0.2, 2);
    }
  }

  drawShip(g, s, fr) {
    const t = this.time;
    const blink = s.iv > 0 && Math.floor(t * 18) % 2 === 0;
    g.save(); g.translate(s.x, s.y);
    if (blink) g.globalAlpha = 0.35;
    g.globalCompositeOperation = 'lighter';
    g.drawImage(this.glow(s.c), -36, -36, 72, 72);
    g.globalCompositeOperation = 'source-over';

    // Ammo pips trail behind the ship
    if (!s.pw) {
      const back = s.a + Math.PI;
      for (let i = 0; i < SP.C.AMMO; i++) {
        const a = back + (i - 1) * 0.42, px = Math.cos(a) * 25, py = Math.sin(a) * 25;
        g.beginPath(); g.arc(px, py, 3.2, 0, SP.TAU);
        if (i < s.am) { g.fillStyle = '#fff'; g.fill(); }
        else {
          g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.2; g.stroke();
          if (i === s.am) { g.beginPath(); g.moveTo(px, py); g.arc(px, py, 3.2, -Math.PI / 2, -Math.PI / 2 + s.rl * SP.TAU); g.fillStyle = 'rgba(255,255,255,0.6)'; g.fill(); }
        }
      }
    }

    g.rotate(s.a);
    // Engine flame
    const sp = Math.hypot(s.vx, s.vy);
    if (s.fr <= 0) {
      const fl = 6 + sp * 1.6 + Math.random() * 5 + (s.dt > 0 ? 14 : 0);
      g.fillStyle = s.dt > 0 ? '#fff' : '#ffb347';
      g.beginPath(); g.moveTo(-7, -5); g.lineTo(-7 - fl, 0); g.lineTo(-7, 5); g.closePath(); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.moveTo(-7, -2.5); g.lineTo(-7 - fl * 0.5, 0); g.lineTo(-7, 2.5); g.closePath(); g.fill();
    }
    // Jouster blades
    if (s.jo > 0) {
      const flick = s.jo < 120 && Math.floor(t * 10) % 2;
      if (!flick) for (const side of [-1, 1]) {
        g.fillStyle = '#e8e8ff'; g.strokeStyle = s.c; g.lineWidth = 2;
        g.beginPath(); g.moveTo(16, side * 21); g.lineTo(-4, side * 17); g.lineTo(-12, side * 21); g.lineTo(-4, side * 25); g.closePath(); g.fill(); g.stroke();
      }
    }
    // Hull
    g.fillStyle = s.c; g.strokeStyle = '#fff'; g.lineWidth = 2.2; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(20, 0); g.lineTo(-12, -14); g.lineTo(-6, 0); g.lineTo(-12, 14); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.moveTo(20, 0); g.lineTo(-6, 0); g.lineTo(-12, 14); g.closePath(); g.fill();
    g.fillStyle = '#0b0d1c'; g.beginPath(); g.arc(3, 0, 4.2, 0, SP.TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(4.3, -1.3, 1.4, 0, SP.TAU); g.fill();
    g.lineJoin = 'miter';

    // Frozen
    if (s.fr > 0) {
      g.fillStyle = 'rgba(160,240,255,0.55)'; g.strokeStyle = '#dffbff'; g.lineWidth = 2;
      g.beginPath();
      for (let i = 0; i < 6; i++) { const a = i / 6 * SP.TAU; g.lineTo(Math.cos(a) * 25, Math.sin(a) * 22); }
      g.closePath(); g.fill(); g.stroke();
    }
    g.rotate(-s.a);

    // Shield bubble
    if (s.sd) {
      g.strokeStyle = '#3fa9ff'; g.globalAlpha = (blink ? 0.35 : 1) * (0.6 + Math.sin(t * 6) * 0.2); g.lineWidth = 2.5;
      g.beginPath(); g.arc(0, 0, 26, 0, SP.TAU); g.stroke();
      g.fillStyle = 'rgba(63,169,255,0.10)'; g.fill();
      g.globalAlpha = blink ? 0.35 : 1;
    }
    // Held power orbits the ship
    if (s.pw) {
      const P = SP.POWERS[s.pw], a = t * 3;
      const px = Math.cos(a) * 30, py = Math.sin(a) * 30;
      g.fillStyle = '#0b0d1c'; g.strokeStyle = P.color; g.lineWidth = 2;
      g.beginPath(); g.arc(px, py, 9, 0, SP.TAU); g.fill(); g.stroke();
      g.save(); g.translate(px, py); drawPowerIcon(g, s.pw, 5.5, P.color); g.restore();
      if (s.pu > 1) { g.fillStyle = '#fff'; g.font = `10px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('×' + s.pu, px + 13, py - 9); }
    }
    g.restore();
  }

  drawPilot(g, s, fr) {
    const t = this.time;
    const blink = s.iv > 0 && Math.floor(t * 18) % 2 === 0;
    g.save(); g.translate(s.x, s.y);
    if (blink) g.globalAlpha = 0.4;
    g.globalCompositeOperation = 'lighter';
    g.drawImage(this.glow(s.c), -22, -22, 44, 44);
    g.globalCompositeOperation = 'source-over';
    // respawn progress ring
    if (!fr.sd && s.rs > 0) {
      const k = 1 - s.rs / SP.C.RESPAWN;
      g.strokeStyle = s.c; g.globalAlpha *= 0.7; g.lineWidth = 2.5;
      g.beginPath(); g.arc(0, 0, 16, -Math.PI / 2, -Math.PI / 2 + k * SP.TAU); g.stroke();
      g.globalAlpha = blink ? 0.4 : 1;
    }
    g.rotate(s.a);
    // jetpack puff
    g.fillStyle = '#ffb347';
    g.beginPath(); g.moveTo(-6, -3); g.lineTo(-11 - Math.random() * 5, 0); g.lineTo(-6, 3); g.fill();
    g.fillStyle = s.c; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.arc(0, 0, 8, 0, SP.TAU); g.fill(); g.stroke();
    g.fillStyle = '#0b0d1c'; g.beginPath(); g.ellipse(3.5, 0, 3, 4.5, 0, 0, SP.TAU); g.fill();
    g.fillStyle = '#9fe8ff'; g.beginPath(); g.ellipse(4.2, -1.2, 1.2, 1.6, 0, 0, SP.TAU); g.fill();
    if (s.fr > 0) { g.fillStyle = 'rgba(160,240,255,0.55)'; g.strokeStyle = '#dffbff'; g.beginPath(); g.arc(0, 0, 13, 0, SP.TAU); g.fill(); g.stroke(); }
    g.restore();
  }

  engineTrails(fr, dt) {
    if (Math.random() > dt * 60) return;
    for (const s of fr.sh) {
      if (s.m === 'd' || s.fr > 0) continue;
      const back = s.m === 's' ? 12 : 7, ca = Math.cos(s.a), sa = Math.sin(s.a);
      this.add({ k: 'dot', x: s.x - ca * back + (Math.random() - 0.5) * 4, y: s.y - sa * back + (Math.random() - 0.5) * 4, vx: -ca * 0.8, vy: -sa * 0.8, life: s.dt > 0 ? 0.45 : 0.25, max: 0.45, c: s.dt > 0 ? '#fff' : s.c, size: s.m === 's' ? 2.6 : 1.6 });
    }
  }

  drawParticles(g) {
    for (const p of this.parts) {
      const k = Math.max(0, p.life / p.max);
      switch (p.k) {
        case 'spark':
          g.globalCompositeOperation = 'lighter';
          g.strokeStyle = p.c; g.globalAlpha = k; g.lineWidth = p.size;
          g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 2, p.y - p.vy * 2); g.stroke();
          break;
        case 'dot':
          g.globalCompositeOperation = 'lighter';
          g.fillStyle = p.c; g.globalAlpha = k;
          g.beginPath(); g.arc(p.x, p.y, p.size * (0.4 + k * 0.6), 0, SP.TAU); g.fill();
          break;
        case 'smoke':
          g.globalCompositeOperation = 'source-over';
          g.fillStyle = '#7a7f99'; g.globalAlpha = k * 0.25;
          g.beginPath(); g.arc(p.x, p.y, p.size * (1.6 - k * 0.6), 0, SP.TAU); g.fill();
          break;
        case 'ring': {
          g.globalCompositeOperation = 'lighter';
          const r = p.r1 + (p.r0 - p.r1) * k;
          g.strokeStyle = p.c; g.globalAlpha = k; g.lineWidth = p.w * k + 0.5;
          g.beginPath(); g.arc(p.x, p.y, Math.max(0.1, r), 0, SP.TAU); g.stroke();
          break;
        }
        case 'flash':
          g.globalCompositeOperation = 'lighter'; g.globalAlpha = k;
          g.drawImage(this.glow(p.c), p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
          break;
        case 'shard':
        case 'confetti':
          g.globalCompositeOperation = 'source-over';
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = Math.min(1, k * 2);
          g.fillStyle = p.c;
          if (p.k === 'confetti') g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          else if (p.sq) g.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          else { g.beginPath(); g.moveTo(p.size, 0); g.lineTo(-p.size / 2, -p.size / 2.5); g.lineTo(-p.size / 2, p.size / 2.5); g.closePath(); g.fill(); }
          g.restore();
          break;
        case 'text':
          g.globalCompositeOperation = 'source-over'; g.globalAlpha = Math.min(1, k * 2);
          g.font = `${p.size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.lineWidth = 4; g.strokeStyle = '#05060f'; g.strokeText(p.s, p.x, p.y);
          g.fillStyle = p.c; g.fillText(p.s, p.x, p.y);
          break;
      }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }

  drawLabels(g, fr, opts) {
    const early = fr.ph === 'countdown' || (fr.ph === 'play' && fr.pt < 120);
    g.font = `12px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const s of fr.sh) {
      if (s.m === 'd') continue;
      const p = fr.pl.find(q => q.id === s.id); if (!p) continue;
      const mine = opts.me && opts.me === s.id;
      if (!early && !opts.names && !mine) continue;
      const y = s.y - (s.m === 's' ? 34 : 22);
      g.globalAlpha = early ? 1 : 0.55;
      const label = mine ? 'YOU' : p.n;
      g.lineWidth = 3; g.strokeStyle = '#05060f'; g.strokeText(label, s.x, y);
      g.fillStyle = p.c; g.fillText(label, s.x, y);
      if (mine && early) {
        const bob = Math.sin(this.time * 8) * 3;
        g.fillStyle = '#fff';
        g.beginPath(); g.moveTo(s.x - 6, y - 18 + bob); g.lineTo(s.x + 6, y - 18 + bob); g.lineTo(s.x, y - 10 + bob); g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  // ------------------------------------------------------------ overlays
  bigText(g, str, x, y, size, color, alpha = 1, stroke = 8) {
    g.globalAlpha = alpha;
    g.font = `${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = stroke; g.strokeStyle = '#05060f'; g.lineJoin = 'round'; g.strokeText(str, x, y);
    g.fillStyle = color; g.fillText(str, x, y);
    g.globalAlpha = 1; g.lineJoin = 'miter';
  }

  drawOverlay(g, fr, opts) {
    const W = SP.W, H = SP.H, cx = W / 2, cy = H / 2;
    if (fr.ph === 'countdown') {
      const n = 3 - Math.floor(fr.pt / 40);
      if (n !== this.lastCount && n >= 1) { this.snd('count'); this.lastCount = n; }
      const k = (fr.pt % 40) / 40;
      this.bigText(g, `ROUND ${fr.rd}`, cx, cy - 110, 30, '#9fb0ff', 1, 6);
      this.bigText(g, fr.map.name.toUpperCase(), cx, cy - 72, 22, '#ffffff', 0.8, 5);
      this.bigText(g, String(Math.max(1, n)), cx, cy + 10, 120 * (1.3 - k * 0.3), '#ffffff', 1 - k * 0.5, 10);
    } else this.lastCount = -1;
    if (fr.ph === 'play' && fr.pt < 45) {
      const k = fr.pt / 45;
      this.bigText(g, 'GO!', cx, cy, 120 + k * 60, '#4dff88', 1 - k, 10);
    }
    if (fr.sd && this.time - this.suddenAt < 2.5 && fr.ph === 'play') {
      const k = (this.time - this.suddenAt) / 2.5;
      this.bigText(g, 'SUDDEN DEATH', cx, cy - 40, 64, '#ff4766', Math.min(1, (1 - k) * 3), 8);
      this.bigText(g, 'no more respawns', cx, cy + 14, 22, '#ffffff', Math.min(1, (1 - k) * 3), 5);
    }
    if (fr.ph === 'roundEnd') {
      const p = fr.pl.find(q => q.id === fr.rw);
      const k = Math.min(1, fr.pt / 15);
      g.fillStyle = `rgba(3,4,11,${0.35 * k})`; g.fillRect(0, cy - 70, W, 140);
      if (p) {
        this.bigText(g, p.n.toUpperCase(), cx, cy - 18, 64 * (0.7 + 0.3 * k), p.c, k, 8);
        this.bigText(g, 'WINS THE ROUND', cx, cy + 36, 26, '#ffffff', k, 5);
      } else this.bigText(g, 'DRAW', cx, cy, 72, '#ffffff', k, 8);
    }
    if (fr.ph === 'scores') this.drawScoreRace(g, fr, opts);
    if (fr.ph === 'over') this.drawWinner(g, fr, opts);
  }

  drawScoreRace(g, fr) {
    const W = SP.W, H = SP.H;
    const fadeIn = Math.min(1, fr.pt / 15), fadeOut = Math.min(1, (SP.C.SCORES - fr.pt) / 15);
    const a = Math.min(fadeIn, fadeOut);
    g.globalAlpha = a;
    g.fillStyle = 'rgba(3,4,11,0.82)'; g.fillRect(0, 0, W, H);
    const rows = fr.pl, rowH = 72, top = H / 2 - (rows.length * rowH) / 2 + 30;
    this.bigText(g, `ROUND ${fr.rd}`, W / 2, top - 70, 40, '#ffffff', a, 6);
    this.bigText(g, `FIRST TO ${fr.tg} WINS`, W / 2, top - 32, 16, '#9fb0ff', a, 4);
    const x0 = 360, x1 = W - 170, n = fr.tg;
    const slot = i => x0 + (x1 - x0) * (i / n);
    const anim = easeOut(Math.max(0, Math.min(1, (fr.pt - 35) / 55)));
    rows.forEach((p, i) => {
      const y = top + i * rowH + rowH / 2;
      g.globalAlpha = a;
      // name
      g.font = `22px ${FONT}`; g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillStyle = p.c; g.fillText(p.n, x0 - 50, y);
      // track
      g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
      const shown = p.p + (p.s - p.p) * anim;
      g.strokeStyle = p.c; g.lineWidth = 4;
      g.beginPath(); g.moveTo(x0, y); g.lineTo(slot(Math.min(shown, n)), y); g.stroke();
      for (let k = 1; k <= n; k++) {
        const filled = shown >= k - 0.01;
        g.fillStyle = filled ? p.c : '#141833';
        g.strokeStyle = filled ? '#fff' : 'rgba(255,255,255,0.2)'; g.lineWidth = 2;
        g.beginPath(); g.arc(slot(k), y, k === n ? 11 : 8, 0, SP.TAU); g.fill(); g.stroke();
      }
      // finish flag
      g.fillStyle = '#fff'; g.font = `18px ${FONT}`; g.textAlign = 'left';
      g.fillText('⚑', x1 + 20, y);
      // the racer
      const sx = slot(Math.max(0, Math.min(shown, n))), gained = p.s > p.p && anim > 0 && anim < 1;
      g.save(); g.translate(sx, y - (gained ? Math.sin(anim * Math.PI) * 14 : 0));
      g.fillStyle = p.c; g.strokeStyle = '#fff'; g.lineWidth = 2; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(20, 0); g.lineTo(-12, -14); g.lineTo(-6, 0); g.lineTo(-12, 14); g.closePath(); g.fill(); g.stroke();
      g.restore();
      g.globalAlpha = a;
      g.font = `24px ${FONT}`; g.textAlign = 'right'; g.fillStyle = '#fff';
      g.fillText(String(p.s), W - 60, y);
      if (p.s !== p.p && anim >= 1) {
        g.font = `14px ${FONT}`; g.fillStyle = p.s > p.p ? '#4dff88' : '#ff4766';
        g.fillText((p.s > p.p ? '+' : '') + (p.s - p.p), W - 90, y - 18);
      }
    });
    g.globalAlpha = 1;
  }

  drawWinner(g, fr, opts) {
    const W = SP.W, H = SP.H, cx = W / 2, cy = H / 2;
    const p = fr.pl.find(q => q.id === fr.mw);
    const k = Math.min(1, fr.pt / 30);
    g.fillStyle = `rgba(3,4,11,${0.7 * k})`; g.fillRect(0, 0, W, H);
    if (!p) return;
    g.save(); g.translate(cx, cy - 90); g.rotate(this.time * 1.2); g.scale(3.2 * k, 3.2 * k);
    g.globalCompositeOperation = 'lighter'; g.drawImage(this.glow(p.c), -40, -40, 80, 80); g.globalCompositeOperation = 'source-over';
    g.fillStyle = p.c; g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(20, 0); g.lineTo(-12, -14); g.lineTo(-6, 0); g.lineTo(-12, 14); g.closePath(); g.fill(); g.stroke();
    g.restore();
    this.bigText(g, p.n.toUpperCase(), cx, cy + 40, 84, p.c, k, 10);
    this.bigText(g, 'WINS THE MATCH!', cx, cy + 108, 34, '#ffffff', k, 6);
    if (opts.overHint) this.bigText(g, opts.overHint, cx, H - 50, 18, '#9fb0ff', k * 0.8, 4);
  }
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Small vector glyphs so every powerup reads at a glance.
function drawPowerIcon(g, type, s, color) {
  g.save();
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = Math.max(1.5, s * 0.28); g.lineCap = 'round'; g.lineJoin = 'round';
  switch (type) {
    case 'laser':
      g.beginPath(); g.moveTo(-s, 0); g.lineTo(s, 0); g.stroke();
      g.strokeStyle = color; g.lineWidth = s * 0.6; g.globalAlpha = 0.6;
      g.beginPath(); g.moveTo(-s, 0); g.lineTo(s, 0); g.stroke();
      break;
    case 'triple':
      for (const a of [-0.5, 0, 0.5]) { g.beginPath(); g.moveTo(-s * 0.7, 0); g.lineTo(-s * 0.7 + Math.cos(a) * s * 1.6, Math.sin(a) * s * 1.6); g.stroke(); }
      break;
    case 'bounce':
      g.beginPath(); g.moveTo(-s, -s * 0.6); g.lineTo(-s * 0.3, s * 0.6); g.lineTo(s * 0.3, -s * 0.6); g.lineTo(s, s * 0.6); g.stroke();
      break;
    case 'homing':
      g.beginPath(); g.arc(0, 0, s * 0.85, 0, SP.TAU); g.stroke();
      g.beginPath(); g.arc(0, 0, s * 0.25, 0, SP.TAU); g.fill();
      g.beginPath(); g.moveTo(-s * 1.2, 0); g.lineTo(-s * 0.5, 0); g.moveTo(s * 0.5, 0); g.lineTo(s * 1.2, 0); g.stroke();
      break;
    case 'mine':
      g.beginPath(); g.arc(0, 0, s * 0.55, 0, SP.TAU); g.fill();
      for (let i = 0; i < 6; i++) { const a = i / 6 * SP.TAU; g.beginPath(); g.moveTo(Math.cos(a) * s * 0.6, Math.sin(a) * s * 0.6); g.lineTo(Math.cos(a) * s, Math.sin(a) * s); g.stroke(); }
      break;
    case 'freeze':
      for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI; g.beginPath(); g.moveTo(Math.cos(a) * s, Math.sin(a) * s); g.lineTo(-Math.cos(a) * s, -Math.sin(a) * s); g.stroke(); }
      break;
    case 'shield':
      g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.85, -s * 0.55); g.lineTo(s * 0.7, s * 0.4); g.lineTo(0, s); g.lineTo(-s * 0.7, s * 0.4); g.lineTo(-s * 0.85, -s * 0.55); g.closePath(); g.stroke();
      break;
    case 'joust':
      g.beginPath(); g.moveTo(-s, s); g.lineTo(s, -s); g.moveTo(s, s); g.lineTo(-s, -s); g.stroke();
      g.beginPath(); g.moveTo(-s * 0.9, s * 0.4); g.lineTo(-s * 0.4, s * 0.9); g.moveTo(s * 0.9, s * 0.4); g.lineTo(s * 0.4, s * 0.9); g.stroke();
      break;
  }
  g.restore();
}

// Tiny static preview of a map for the lobby picker.
function drawMapThumb(canvas, map) {
  const g = canvas.getContext('2d'), s = canvas.width / SP.W;
  g.setTransform(s, 0, 0, s, 0, 0);
  g.fillStyle = '#0a0d24'; g.fillRect(0, 0, SP.W, SP.H);
  g.strokeStyle = '#3d55c9'; g.lineWidth = 16; g.strokeRect(0, 0, SP.W, SP.H);
  g.fillStyle = '#45c8ff';
  for (const w of map.walls) g.fillRect(w[0], w[1], w[2], w[3]);
  g.fillStyle = '#ffb347';
  for (const b of map.blocks) g.fillRect(b[0] + 3, b[1] + 3, b[2] - 6, b[3] - 6);
  for (const c of map.circles) { g.fillStyle = '#45c8ff'; g.beginPath(); g.arc(c.x, c.y, c.r, 0, SP.TAU); g.fill(); }
  for (const c of map.bumpers) { g.fillStyle = '#ff4dd8'; g.beginPath(); g.arc(c.x, c.y, c.r, 0, SP.TAU); g.fill(); }
  for (const a of map.asteroids) { g.fillStyle = '#8f9ad8'; g.beginPath(); g.arc(a[0], a[1], a[2], 0, SP.TAU); g.fill(); }
  if (map.sun) { g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(map.sun.x, map.sun.y, map.sun.r * 1.4, 0, SP.TAU); g.fill(); }
  g.strokeStyle = '#45c8ff'; g.lineCap = 'round';
  for (const sp of map.spinners) for (const sg of SP.spinSegs(sp, 0)) { g.lineWidth = sp.th * 1.5; g.beginPath(); g.moveTo(sg[0], sg[1]); g.lineTo(sg[2], sg[3]); g.stroke(); }
}
