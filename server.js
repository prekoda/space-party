// Space Party server: serves the PWA and runs authoritative online rooms.
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const SP = require('./public/js/sim.js');

const PORT = process.env.PORT || 3001;
const RECONNECT_GRACE_MS = 30000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.FRONTEND_URL || '*' }, pingInterval: 5000, pingTimeout: 8000 });

const publicPath = path.join(__dirname, 'public');
app.use((req, res, next) => {
  // The shell, manifest and service worker must revalidate so installed PWAs pick up updates.
  if (req.path === '/' || /\.(html|webmanifest)$/.test(req.path) || req.path === '/sw.js') res.set('Cache-Control', 'no-cache');
  next();
});
app.use(express.static(publicPath));
app.get('/{*path}', (req, res, next) => {
  if (path.extname(req.path)) return next();
  res.sendFile(path.join(publicPath, 'index.html'));
});

// -------------------------------------------------------------------- rooms
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function makeCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join(''); } while (rooms.has(c));
  return c;
}
const cleanName = n => String(n || '').replace(/[^\p{L}\p{N} _\-.!?]/gu, '').trim().slice(0, 14) || 'Pilot';
const validPid = p => typeof p === 'string' && p.length >= 6 && p.length <= 40;

class Room {
  constructor(code) {
    this.code = code;
    this.game = new SP.Game();
    this.humans = new Map(); // pid -> { sock, q, lastR, ack, pf, pd, goneAt }
    this.host = null;
    this.botSeq = 0;
    this.lastPhase = 'lobby';
  }

  lobbyState() {
    const g = this.game;
    return {
      code: this.code, host: this.host, phase: g.phase, settings: g.settings,
      custom: this.custom && g.settings.map === this.custom.id ? this.custom : null,
      players: g.players.map(p => {
        const h = this.humans.get(p.id);
        return { id: p.id, name: p.name, color: p.color, bot: p.bot, score: p.score, away: !!(h && !h.sock) };
      }),
    };
  }
  broadcastLobby() { io.to(this.code).emit('lobby', this.lobbyState()); }

  addHuman(sock, pid, name) {
    const taken = new Set(this.game.players.map(p => p.name));
    for (let n = 2; taken.has(name); n++) name = name.slice(0, 12) + ' ' + n;
    const p = this.game.addPlayer({ id: pid, name });
    if (!p) return false;
    this.humans.set(pid, { sock, q: [], lastR: 0, ack: 0, pf: 0, pd: 0, goneAt: 0 });
    if (!this.host) this.host = pid;
    return true;
  }
  attach(sock, pid) {
    const h = this.humans.get(pid);
    if (h.sock && h.sock !== sock) h.sock.disconnect(true);
    h.sock = sock; h.goneAt = 0; h.q = []; h.lastR = 0;
  }
  removeHuman(pid) {
    this.humans.delete(pid);
    this.game.removePlayer(pid);
    if (this.host === pid) this.host = this.humans.keys().next().value || null;
    if (!this.humans.size) { rooms.delete(this.code); return; }
    // Not enough players left to continue a match
    if (this.game.phase !== 'lobby' && this.game.players.length < 2) { this.game.phase = 'lobby'; this.game.ships = []; }
    this.broadcastLobby();
  }

  tick(now) {
    for (const [pid, h] of this.humans) if (!h.sock && now - h.goneAt > RECONNECT_GRACE_MS) this.removeHuman(pid);
    if (!rooms.has(this.code)) return;

    const g = this.game;
    const inputs = {};
    for (const [pid, h] of this.humans) {
      if (!h.sock) { inputs[pid] = { r: 0, f: 0, d: 0, h: 0 }; continue; }
      // Merge any backlog so a lag spike doesn't leave the player permanently behind.
      while (h.q.length > 3) { const x = h.q.shift(); h.pf |= x.f; h.pd |= x.d; h.ack = x.s; }
      if (h.q.length) {
        const x = h.q.shift();
        inputs[pid] = { r: x.r, f: x.f | h.pf, d: x.d | h.pd, h: x.h };
        h.pf = h.pd = 0; h.ack = x.s; h.lastR = x.r; h.lastH = x.h;
      } else inputs[pid] = { r: h.lastR, f: 0, d: 0, h: h.lastH || 0 };
    }
    g.step(inputs);

    if (g.phase !== this.lastPhase && (g.phase === 'lobby' || this.lastPhase === 'lobby')) this.broadcastLobby();
    this.lastPhase = g.phase;
    if (g.phase === 'lobby') { g.takeEvents(); return; }
    if (g.frame % 2 === 0) {
      const snap = g.snapshot();
      snap.ev = g.takeEvents();
      snap.ak = {};
      for (const [pid, h] of this.humans) snap.ak[pid] = h.ack;
      io.to(this.code).emit('s', snap);
    }
  }
}

// -------------------------------------------------------------------- sockets
io.on('connection', sock => {
  let room = null, pid = null;
  const isHost = () => room && room.host === pid;

  function enter(r, cb) {
    room = r;
    sock.join(r.code);
    cb({ ok: true, code: r.code, id: pid });
    r.broadcastLobby();
  }

  sock.on('create', (o, cb) => {
    if (typeof cb !== 'function' || !o || !validPid(o.pid) || room) return;
    pid = o.pid;
    const r = new Room(makeCode());
    rooms.set(r.code, r);
    r.addHuman(sock, pid, cleanName(o.name));
    enter(r, cb);
  });

  sock.on('join', (o, cb) => {
    if (typeof cb !== 'function' || !o || !validPid(o.pid) || room) return;
    const r = rooms.get(String(o.code || '').toUpperCase().trim());
    if (!r) return cb({ ok: false, error: 'Room not found' });
    pid = o.pid;
    if (r.humans.has(pid)) r.attach(sock, pid);
    else if (!r.addHuman(sock, pid, cleanName(o.name))) return cb({ ok: false, error: 'Room is full (6 max)' });
    enter(r, cb);
  });

  sock.on('i', a => {
    if (!room || !Array.isArray(a)) return;
    const h = room.humans.get(pid);
    if (!h || h.sock !== sock || h.q.length > 30) return;
    h.q.push({ s: a[0] | 0, r: a[1] ? 1 : 0, f: a[2] ? 1 : 0, d: a[3] ? 1 : 0, h: a[4] ? 1 : 0 });
  });

  sock.on('settings', o => {
    if (!isHost() || !o) return;
    const s = room.game.settings;
    if (o.custom && o.map === o.custom.id && SP.validateMapDef(o.custom)) {
      // Host-made map: validate, build, and keep it only for this room.
      try {
        const def = { id: o.custom.id, name: o.custom.name, theme: o.custom.theme, grid: o.custom.grid.slice() };
        room.game.extraMaps = { [def.id]: SP.buildGridMap(def) };
        room.custom = def; s.map = def.id;
      } catch (e) { }
    } else if (o.map === 'random' || SP.MAP_BY_ID[o.map]) s.map = o.map;
    if ([5, 7, 10, 15].includes(o.target)) s.target = o.target;
    room.broadcastLobby();
  });

  sock.on('addBot', o => {
    if (!isHost() || room.game.phase !== 'lobby') return;
    const level = o && SP.LEVELS[o.level] ? o.level : 'normal';
    if (room.game.addPlayer({ id: 'bot' + (++room.botSeq), bot: level })) room.broadcastLobby();
  });

  sock.on('kick', id => {
    if (!isHost() || id === pid) return;
    const h = room.humans.get(id);
    if (h) { if (h.sock) { h.sock.emit('kicked'); h.sock.leave(room.code); } room.removeHuman(id); }
    else { room.game.removePlayer(id); room.broadcastLobby(); }
  });

  sock.on('color', () => {
    if (!room || room.game.phase !== 'lobby') return;
    room.game.cycleColor(pid);
    room.broadcastLobby();
  });

  sock.on('start', () => {
    if (!isHost() || room.game.phase !== 'lobby') return;
    if (room.game.startMatch()) room.broadcastLobby();
  });

  sock.on('endMatch', () => {
    if (!isHost() || room.game.phase === 'lobby') return;
    room.game.phase = 'lobby'; room.game.ships = [];
  });

  sock.on('ping2', (t, cb) => { if (typeof cb === 'function') cb(t); });

  sock.on('leave', () => {
    if (!room) return;
    sock.leave(room.code);
    room.removeHuman(pid);
    room = null;
  });

  sock.on('disconnect', () => {
    if (!room) return;
    const h = room.humans.get(pid);
    if (h && h.sock === sock) { h.sock = null; h.goneAt = Date.now(); room.broadcastLobby(); }
  });
});

// -------------------------------------------------------------------- fixed-step loop
let last = performance.now(), acc = 0;
function loop() {
  const now = performance.now();
  acc += now - last; last = now;
  let n = 0;
  while (acc >= SP.TICK_MS && n < 6) {
    acc -= SP.TICK_MS; n++;
    const wall = Date.now();
    for (const r of rooms.values()) r.tick(wall);
  }
  if (n === 6) acc = 0;
  setTimeout(loop, Math.max(1, Math.floor(SP.TICK_MS - acc)));
}
loop();

server.listen(PORT, () => console.log(`Space Party running on http://localhost:${PORT}`));
