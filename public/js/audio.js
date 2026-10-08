// Synthesized sound effects and music (WebAudio) — no asset downloads, works offline.
const Audio2 = (() => {
  let ctx = null, master = null, sfxBus = null, musicBus = null, musicFilter = null, noiseBuf = null;
  const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v === '1'; } catch (e) { return d; } };
  const state = { muted: ls('sp-muted', false), music: ls('sp-music', true) };

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = state.muted ? 0 : 1;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.5; sfxBus.connect(master);
    musicFilter = ctx.createBiquadFilter(); musicFilter.type = 'lowpass'; musicFilter.frequency.value = 18000;
    musicBus = ctx.createGain(); musicBus.gain.value = state.music ? 0.32 : 0;
    musicBus.connect(musicFilter); musicFilter.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    document.addEventListener('visibilitychange', () => { if (document.hidden) ctx.suspend(); else ctx.resume(); });
  }
  function unlock() { init(); if (ctx && ctx.state === 'suspended' && !document.hidden) ctx.resume(); if (ctx) Music._kick(); }

  function tone(dest, type, f0, f1, dur, vol, t, attack = 0.002) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dest, dur, vol, f0, f1, filter, t, q = 0.8) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = filter; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------------ sound effects
  const T = (type, f0, f1, dur, vol, delay = 0) => tone(sfxBus, type, f0, f1, dur, vol, ctx.currentTime + delay);
  const N = (dur, vol, f0, f1, filter = 'lowpass', delay = 0, q = 0.8) => noise(sfxBus, dur, vol, f0, f1, filter, ctx.currentTime + delay, q);
  const arp = (notes, step, type = 'square', vol = 0.07, len = 0.07) => notes.forEach((f, i) => T(type, f, f, len, vol, i * step));

  const sounds = {
    shot: () => { T('square', 900, 240, 0.08, 0.1); N(0.05, 0.1, 6000, 1500, 'highpass'); },
    triple: () => { T('square', 720, 170, 0.11, 0.11); N(0.08, 0.14, 5000, 900, 'highpass'); },
    ric: () => T('triangle', 1800, 900, 0.06, 0.08),
    missile: () => { N(0.35, 0.14, 400, 2400, 'bandpass', 0, 3); T('sawtooth', 120, 260, 0.3, 0.05); },
    ice: () => { T('sine', 2400, 900, 0.18, 0.1); T('triangle', 1600, 3200, 0.12, 0.05); },
    dry: () => { T('square', 160, 120, 0.035, 0.07); T('square', 120, 90, 0.035, 0.06, 0.05); },
    dash: () => { N(0.2, 0.16, 700, 4500, 'bandpass', 0, 1.5); T('sine', 200, 500, 0.15, 0.06); },
    wall: () => { T('sine', 140, 60, 0.12, 0.22); N(0.06, 0.12, 1800, 300, 'lowpass'); },
    kill: () => { N(0.6, 0.45, 3200, 60); T('sawtooth', 170, 30, 0.45, 0.16); T('square', 90, 40, 0.3, 0.1, 0.03); },
    elim: () => { N(0.25, 0.28, 4000, 300, 'bandpass', 0, 1.2); T('square', 560, 60, 0.32, 0.12); },
    boom: () => { N(0.75, 0.5, 1800, 40); T('sine', 95, 25, 0.6, 0.38); },
    block: () => N(0.12, 0.14, 2500, 400, 'bandpass', 0, 1.4),
    crate: () => { N(0.15, 0.17, 3000, 600, 'bandpass'); T('triangle', 500, 900, 0.12, 0.07, 0.04); },
    pick: () => arp([660, 880, 1320], 0.05),
    activate: () => { T('sawtooth', 300, 1200, 0.18, 0.06); arp([880, 1175, 1760], 0.045, 'square', 0.06, 0.08); },
    shieldOn: () => { T('sine', 400, 1600, 0.3, 0.1); arp([988, 1319], 0.08, 'triangle', 0.08, 0.15); },
    joustOn: () => { N(0.25, 0.15, 3000, 9000, 'bandpass', 0, 4); T('square', 1500, 1500, 0.06, 0.06, 0.05); T('square', 2000, 2000, 0.08, 0.06, 0.12); },
    reverse: () => { T('sawtooth', 900, 200, 0.4, 0.1); T('sawtooth', 1200, 260, 0.4, 0.06, 0.04); T('sine', 300, 600, 0.3, 0.08, 0.3); },
    charge: () => { T('sawtooth', 180, 1400, 0.5, 0.08); T('sine', 90, 700, 0.5, 0.07); },
    laser: () => { T('sawtooth', 1200, 140, 0.4, 0.15); N(0.35, 0.24, 8000, 800, 'highpass'); },
    bump: () => { T('sine', 300, 700, 0.12, 0.15); T('square', 600, 1200, 0.05, 0.05); },
    bonk: () => T('triangle', 220, 120, 0.09, 0.1),
    freeze: () => { T('sine', 3000, 600, 0.4, 0.1); N(0.3, 0.1, 9000, 3000, 'highpass'); },
    shatter: () => { N(0.4, 0.3, 9000, 1500, 'highpass'); [2400, 3100, 1900].forEach((f, i) => T('triangle', f, f * 0.7, 0.12, 0.06, i * 0.03)); },
    shield: () => { T('sine', 1200, 300, 0.25, 0.12); N(0.15, 0.1, 5000, 1000, 'bandpass'); },
    clang: () => { T('square', 1500, 1400, 0.08, 0.07); T('triangle', 2300, 2000, 0.14, 0.06); },
    beep: () => T('square', 1500, 1500, 0.06, 0.08),
    punch: () => { N(0.08, 0.22, 1200, 300, 'lowpass'); T('square', 220, 90, 0.08, 0.1); },
    drop: () => T('triangle', 300, 150, 0.12, 0.1),
    respawn: () => arp([400, 600, 800], 0.05, 'triangle', 0.08),
    sizzle: () => N(0.15, 0.08, 6000, 2000, 'highpass'),
    count: () => T('square', 440, 440, 0.12, 0.1),
    go: () => { T('square', 880, 880, 0.28, 0.1); T('square', 1320, 1320, 0.28, 0.06); },
    point: () => { T('square', 990, 990, 0.06, 0.07); T('square', 1480, 1480, 0.12, 0.07, 0.06); },
    lose: () => T('square', 300, 150, 0.2, 0.07),
    sudden: () => [0, 0.18, 0.36].forEach(d => T('sawtooth', 220, 200, 0.14, 0.1, d)),
    roundWin: () => arp([523, 659, 784, 1047], 0.09, 'square', 0.08, 0.12),
    matchWin: () => arp([523, 659, 784, 1047, 784, 1047, 1319], 0.11, 'square', 0.08, 0.16),
    ui: () => T('triangle', 900, 1200, 0.05, 0.06),
  };
  const lastPlayed = {};
  function play(name) {
    if (!ctx || state.muted || !sounds[name] || ctx.state !== 'running') return;
    const now = performance.now();
    if (now - (lastPlayed[name] || 0) < 35) return;
    lastPlayed[name] = now;
    try { sounds[name](); } catch (e) { }
  }

  // ------------------------------------------------------------------ music (original chiptune, A minor)
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const PROG = [ // root (bass midi), chord tones (arp/pad midi)
    { root: 45, chord: [57, 60, 64] }, // Am
    { root: 41, chord: [53, 57, 60] }, // F
    { root: 48, chord: [55, 60, 64] }, // C
    { root: 43, chord: [55, 59, 62] }, // G
  ];
  // lead line: [step in 4-bar loop, midi, length in 16ths]
  const LEAD = [
    [0, 76, 2], [2, 74, 2], [4, 72, 2], [6, 74, 2], [8, 76, 4], [12, 79, 2], [14, 76, 2],
    [16, 77, 2], [18, 76, 2], [20, 74, 2], [22, 72, 2], [24, 74, 6], [30, 72, 2],
    [32, 72, 2], [34, 74, 2], [36, 76, 2], [38, 79, 2], [40, 81, 4], [44, 79, 2], [46, 76, 2],
    [48, 74, 2], [50, 76, 2], [52, 74, 2], [54, 71, 2], [56, 74, 8],
  ];
  const LEAD_AT = new Map(LEAD.map(n => [n[0], n]));
  const BASS = [1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0]; // syncopated 16th gates
  const TRACKS = { menu: { bpm: 112 }, battle: { bpm: 152 } };

  const Music = {
    track: null, intensity: 1, step: 0, nextT: 0, timer: null, loops: 0,
    play(name) {
      if (this.track === name) return;
      this.track = name; this.step = 0; this.loops = 0;
      if (!ctx) return;
      this.nextT = ctx.currentTime + 0.08;
      this._kick();
    },
    stop() { this.track = null; },
    setIntensity(n) {
      if (n === this.intensity) return;
      this.intensity = n;
      if (musicFilter) musicFilter.frequency.setTargetAtTime(n === 0 ? 900 : 18000, ctx.currentTime, 0.25);
    },
    _kick() {
      if (!ctx || this.timer) return;
      this.nextT = ctx.currentTime + 0.08;
      this.timer = setInterval(() => this._schedule(), 25);
    },
    _schedule() {
      if (!this.track || !state.music || state.muted || ctx.state !== 'running') { this.nextT = ctx.currentTime + 0.05; return; }
      const tr = TRACKS[this.track];
      const bpm = tr.bpm * (this.intensity === 2 ? 1.08 : 1);
      const dt = 60 / bpm / 4;
      if (this.nextT < ctx.currentTime - 0.2) this.nextT = ctx.currentTime + 0.05; // recovered from a stall
      while (this.nextT < ctx.currentTime + 0.12) {
        this.track === 'battle' ? this._battle(this.step, this.nextT, dt) : this._menu(this.step, this.nextT, dt);
        this.nextT += dt; this.step++;
        if (this.step % 64 === 0) this.loops++;
      }
    },
    _battle(step, t, dt) {
      const s16 = step % 16, bar = Math.floor(step / 16) % 4, ch = PROG[bar], hot = this.intensity === 2, calm = this.intensity === 0;
      const B = musicBus;
      // drums
      if (s16 % 4 === 0 || (bar === 3 && s16 === 14)) { tone(B, 'sine', 160, 42, 0.16, 0.9, t); }
      if (!calm && (s16 === 4 || s16 === 12)) { noise(B, 0.13, 0.35, 2200, 900, 'bandpass', t, 0.9); tone(B, 'triangle', 200, 160, 0.06, 0.2, t); }
      if (!calm && (hot || s16 % 2 === 1)) noise(B, s16 === 14 ? 0.12 : 0.03, 0.12, 9000, 7000, 'highpass', t);
      // bass
      if (BASS[s16]) {
        const m = ch.root + (s16 === 6 || s16 === 14 ? 12 : 0);
        tone(B, 'square', mtof(m), mtof(m), dt * 1.6, 0.16, t, 0.004);
        tone(B, 'triangle', mtof(m - 12), mtof(m - 12), dt * 1.6, 0.2, t, 0.004);
      }
      // arpeggio
      if (!calm) {
        const n = ch.chord[s16 % 3] + 12 * (s16 % 6 < 3 ? 0 : 1);
        tone(B, 'square', mtof(n), mtof(n), dt * 0.8, 0.045, t);
      }
      // lead on every other loop (always when it gets hot)
      if (!calm && (hot || this.loops % 2 === 1)) {
        const L = LEAD_AT.get(step % 64);
        if (L) { tone(B, 'square', mtof(L[1]), mtof(L[1]), dt * L[2] * 0.95, 0.06, t, 0.01); tone(B, 'triangle', mtof(L[1] + 12), mtof(L[1] + 12), dt * L[2] * 0.9, 0.04, t, 0.01); }
      }
    },
    _menu(step, t, dt) {
      const s16 = step % 16, bar = Math.floor(step / 16) % 4, ch = PROG[bar], B = musicBus;
      if (s16 === 0 || s16 === 10) tone(B, 'sine', 120, 40, 0.2, 0.6, t);
      if (s16 === 0) for (const n of ch.chord) tone(B, 'sawtooth', mtof(n), mtof(n), dt * 15, 0.025, t, 0.3);
      if (s16 % 2 === 0) { const n = ch.chord[(s16 / 2) % 3] + 12; tone(B, 'triangle', mtof(n), mtof(n), dt * 1.5, 0.06, t); }
      if (s16 % 4 === 2) noise(B, 0.03, 0.06, 9000, 7000, 'highpass', t);
      if (s16 === 0 || s16 === 8) tone(B, 'triangle', mtof(ch.root), mtof(ch.root), dt * 6, 0.18, t, 0.01);
    },
  };

  function setMuted(m) {
    state.muted = m;
    try { localStorage.setItem('sp-muted', m ? '1' : '0'); } catch (e) { }
    if (master) master.gain.value = m ? 0 : 1;
  }
  function setMusic(on) {
    state.music = on;
    try { localStorage.setItem('sp-music', on ? '1' : '0'); } catch (e) { }
    if (musicBus) musicBus.gain.value = on ? 0.32 : 0;
  }
  return { unlock, play, setMuted, setMusic, Music, get muted() { return state.muted; }, get music() { return state.music; } };
})();
const Sfx = Audio2;
const Music = Audio2.Music;
