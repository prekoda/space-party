// Online session: talks to the authoritative server.
// - Other ships are interpolated ~100 ms in the past for smooth motion.
// - Your own ship is predicted locally with the shared physics and reconciled
//   against server acks, so rotate/dash respond instantly even with latency.
const INTERP_FRAMES = 6;
const recoil = (s, k) => { s.vx -= Math.cos(s.a) * k; s.vy -= Math.sin(s.a) * k; };

class OnlineSession {
  constructor(renderer, handlers) {
    this.r = renderer;
    this.h = handlers;
    this.socket = io({ transports: ['websocket', 'polling'] });
    this.ctrl = new Controller();
    this.me = null; this.code = null; this.name = '';
    this.snaps = []; this.latest = null; this.evQ = [];
    this.seq = 0; this.pending = []; this.pred = null; this.predWorld = null;
    this.err = { x: 0, y: 0, a: 0 };
    this.clockOff = null; this.acc = 0; this.ping = 0;
    this.blockCache = { key: '', arr: [] };
    this.inGame = false;

    const s = this.socket;
    s.on('s', snap => this.onSnap(snap));
    s.on('lobby', st => { this.lobby = st; this.h.onLobby(st); });
    s.on('kicked', () => { this.code = null; this.h.onKicked(); });
    s.on('connect', () => {
      if (this.code) s.emit('join', { code: this.code, name: this.name, pid: this.me }, res => { if (!res.ok) { this.code = null; this.h.onKicked(res.error); } });
      this.h.onConnection(true);
    });
    s.on('disconnect', () => this.h.onConnection(false));
    this.pingTimer = setInterval(() => {
      if (s.connected) s.emit('ping2', performance.now(), t => { this.ping = Math.round(performance.now() - t); });
    }, 2000);
  }

  create(name, pid, cb) { this.name = name; this.socket.emit('create', { name, pid }, res => this.joined(res, cb)); }
  join(code, name, pid, cb) { this.name = name; this.socket.emit('join', { code, name, pid }, res => this.joined(res, cb)); }
  joined(res, cb) { if (res.ok) { this.code = res.code; this.me = res.id; } cb(res); }
  leave() { this.socket.emit('leave'); this.code = null; this.reset(); }
  send(ev, data) { this.socket.emit(ev, data); }
  destroy() { clearInterval(this.pingTimer); this.socket.disconnect(); }
  reset() { this.snaps = []; this.latest = null; this.evQ = []; this.pending = []; this.pred = null; this.clockOff = null; }

  blocksOf(snap) {
    if (this.blockCache.key !== snap.bk) this.blockCache = { key: snap.bk, arr: [...snap.bk].map(c => c === '1') };
    return this.blockCache.arr;
  }
  worldOf(snap) {
    return { map: SP.MAP_BY_ID[snap.map], blocks: this.blocksOf(snap), asteroids: snap.as, tick: snap.t, canMove: snap.ph !== 'countdown', sim: false };
  }

  onSnap(s) {
    const now = performance.now();
    const off = s.f - now / SP.TICK_MS;
    // Track the earliest-arriving packets; jitter is absorbed by the interpolation delay.
    if (this.clockOff === null || Math.abs(off - this.clockOff) > 40) this.clockOff = off;
    else this.clockOff += (off - this.clockOff) * (off > this.clockOff ? 0.25 : 0.02);
    if (this.latest && s.rd !== this.latest.rd) this.snaps = [];
    this.snaps.push(s);
    if (this.snaps.length > 40) this.snaps.shift();
    for (const e of s.ev) this.evQ.push(e);
    this.latest = s;
    this.reconcile(s);
  }

  reconcile(s) {
    const me = s.sh.find(x => x.id === this.me);
    const ack = s.ak[this.me] || 0;
    while (this.pending.length && this.pending[0].seq <= ack) this.pending.shift();
    if (!me || me.m === 'd' || (s.ph !== 'countdown' && s.ph !== 'play')) { this.pred = null; return; }
    const base = SP.shipFromSnap(me);
    const w = this.worldOf(s);
    for (const p of this.pending) { w.tick++; SP.moveShip(base, p.inp, w); if (p.recoil) recoil(base, p.recoil); }
    if (this.pred && this.pred.mode === base.mode) {
      this.err.x += this.pred.x - base.x; this.err.y += this.pred.y - base.y; this.err.a += SP.adiff(this.pred.a, base.a);
      if (Math.hypot(this.err.x, this.err.y) > 90) this.err.x = this.err.y = this.err.a = 0;
    } else this.err.x = this.err.y = this.err.a = 0;
    this.pred = base;
    this.predWorld = w;
  }

  update(dt) {
    this.acc += dt * 1000;
    let n = 0;
    while (this.acc >= SP.TICK_MS && n < 5) { this.acc -= SP.TICK_MS; n++; this.localTick(); }
    if (n === 5) this.acc = 0;
    const k = Math.pow(0.0008, dt);
    this.err.x *= k; this.err.y *= k; this.err.a *= k;
  }

  localTick() {
    if (!this.inGame) { this.ctrl.sample(); return; }
    const inp = this.ctrl.sample();
    this.seq++;
    this.socket.emit('i', [this.seq, inp.r, inp.f, inp.d]);
    this.pending.push({ seq: this.seq, inp });
    if (this.pending.length > 90) this.pending.shift();
    if (!this.pred || !this.predWorld) return;
    const dashBefore = this.pred.dashCd;
    this.predWorld.tick++;
    SP.moveShip(this.pred, inp, this.predWorld);
    const entry = this.pending[this.pending.length - 1];
    // Instant local feedback; the server's own versions of these events are skipped.
    if (this.pred.dashCd > dashBefore) this.r.fx({ e: 'dash', id: this.me }, this.lastFrame || this.latest, true);
    if (inp.f && this.latest) {
      const me = this.latest.sh.find(x => x.id === this.me);
      const firesPending = this.pending.reduce((n, p) => n + p.inp.f, 0) - 1;
      if (me && me.m === 's' && me.fr <= 0 && me.ch <= 0 && me.bm <= 0) {
        if (me.pw) { if (me.pw !== 'laser' && me.pw !== 'mine') { this.localShot(me.pw); entry.recoil = SP.C.RECOIL * 1.5; } }
        else if (me.am - firesPending > 0) { this.localShot(null); entry.recoil = SP.C.RECOIL; }
        if (entry.recoil) recoil(this.pred, entry.recoil);
        else Sfx.play('dry');
      }
    }
  }
  localShot(pw) {
    const k = pw === 'triple' ? 't' : pw === 'homing' ? 'm' : pw === 'freeze' ? 'i' : 'n';
    this.r.fx({ e: 'shot', id: this.me, k }, this.lastFrame || this.latest, true);
  }

  // Builds the frame to render: interpolated world + predicted own ship.
  frame() {
    if (!this.snaps.length) return null;
    const now = performance.now();
    const serverNow = this.clockOff + now / SP.TICK_MS;
    const rf = serverNow - INTERP_FRAMES;
    let a = this.snaps[0], b = null;
    for (let i = 0; i < this.snaps.length; i++) {
      if (this.snaps[i].f <= rf) a = this.snaps[i];
      else { b = this.snaps[i]; break; }
    }
    while (this.snaps.length > 2 && this.snaps[1].f < rf - 30) this.snaps.shift();
    let alpha = 0;
    if (b && b.f > a.f && a.f <= rf) alpha = Math.min(1, (rf - a.f) / (b.f - a.f));
    else if (!b) b = a;
    const L = this.latest;

    const lerpList = (la, lb, f) => {
      const byId = new Map(la.map(o => [o.id, o]));
      return lb.map(o => { const p = byId.get(o.id); return p ? f(p, o) : o; });
    };
    const ships = lerpList(a.sh, b.sh, (p, o) => Object.assign({}, o, {
      x: p.x + (o.x - p.x) * alpha, y: p.y + (o.y - p.y) * alpha, a: p.a + SP.adiff(o.a, p.a) * alpha,
    }));
    // Own ship: predicted position, freshest status flags.
    const mine = L.sh.find(s => s.id === this.me);
    const i = ships.findIndex(s => s.id === this.me);
    if (mine) {
      const v = Object.assign({}, mine);
      if (this.pred) { v.x = this.pred.x + this.err.x; v.y = this.pred.y + this.err.y; v.a = this.pred.a + this.err.a; v.vx = this.pred.vx; v.vy = this.pred.vy; v.dt = this.pred.dashT; }
      if (i >= 0) ships[i] = v; else ships.push(v);
    }
    // Bullets: others' shown on the interpolated timeline, ours extrapolated to "now" so they leave the nose.
    const bullets = [];
    for (const q of a.bu) {
      if (q.o === this.me) continue;
      const dtf = rf - a.f;
      bullets.push(Object.assign({}, q, { x: q.x + q.vx * dtf, y: q.y + q.vy * dtf }));
    }
    const ahead = Math.min(10, serverNow - L.f);
    for (const q of L.bu) if (q.o === this.me) bullets.push(Object.assign({}, q, { x: q.x + q.vx * ahead, y: q.y + q.vy * ahead }));

    const asteroids = lerpList(a.as, b.as, (p, o) => Object.assign({}, o, { x: p.x + (o.x - p.x) * alpha, y: p.y + (o.y - p.y) * alpha, a: p.a + (o.a - p.a) * alpha }));
    const samePh = a.ph === b.ph;
    const fr = {
      ph: b.ph, pt: samePh ? a.pt + (b.pt - a.pt) * alpha : b.pt, rd: b.rd, map: SP.MAP_BY_ID[b.map], sd: b.sd, tg: b.tg, rw: b.rw, mw: b.mw,
      pl: L.pl, bk: b.bk, t: a.t + (b.t - a.t) * alpha,
      sh: ships, bu: bullets, mi: b.mi, it: b.it, cr: b.cr, as: asteroids,
    };
    this.lastFrame = fr;

    // Release queued events once the interpolated timeline reaches them.
    while (this.evQ.length && (this.evQ[0].f <= rf + 1 || this.evQ.length > 200)) {
      const e = this.evQ.shift();
      const isMe = e.id === this.me;
      if (isMe && (e.e === 'shot' || e.e === 'dash' || e.e === 'dry')) continue;
      this.r.fx(e, fr, isMe);
    }
    return fr;
  }
}
