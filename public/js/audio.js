// Synthesized sound effects (WebAudio) — no asset downloads, works offline.
const Sfx = (() => {
  let ctx = null, out = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('sp-muted') === '1'; } catch (e) { }
  const lastPlayed = {};

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = muted ? 0 : 0.45;
    const comp = ctx.createDynamicsCompressor();
    out.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function unlock() { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); }

  function tone(type, f0, f1, dur, vol, delay = 0) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, f0, f1, filter = 'lowpass', delay = 0, q = 0.8) {
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = filter; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  const sounds = {
    shot: () => { tone('square', 880, 220, 0.09, 0.08); noise(0.05, 0.08, 6000, 1500, 'highpass'); },
    triple: () => { tone('square', 700, 160, 0.12, 0.09); noise(0.08, 0.12, 5000, 900, 'highpass'); },
    ric: () => tone('triangle', 1800, 900, 0.06, 0.06),
    missile: () => { noise(0.35, 0.12, 400, 2400, 'bandpass', 0, 3); tone('sawtooth', 120, 260, 0.3, 0.04); },
    ice: () => { tone('sine', 2400, 900, 0.18, 0.08); tone('triangle', 1600, 3200, 0.12, 0.04); },
    dry: () => tone('square', 140, 110, 0.04, 0.05),
    dash: () => noise(0.18, 0.12, 900, 4000, 'bandpass', 0, 1.5),
    kill: () => { noise(0.55, 0.38, 3000, 60); tone('sawtooth', 160, 30, 0.45, 0.14); tone('square', 90, 40, 0.3, 0.08, 0.03); },
    elim: () => { noise(0.25, 0.25, 4000, 300, 'bandpass', 0, 1.2); tone('square', 520, 60, 0.3, 0.1); },
    boom: () => { noise(0.7, 0.42, 1800, 40); tone('sine', 90, 25, 0.6, 0.3); },
    block: () => noise(0.12, 0.12, 2500, 400, 'bandpass', 0, 1.4),
    crate: () => { noise(0.15, 0.15, 3000, 600, 'bandpass'); tone('triangle', 500, 900, 0.12, 0.06, 0.04); },
    pick: () => { [660, 880, 1320].forEach((f, i) => tone('square', f, f, 0.07, 0.07, i * 0.055)); },
    charge: () => { tone('sawtooth', 180, 1400, 0.5, 0.07); tone('sine', 90, 700, 0.5, 0.06); },
    laser: () => { tone('sawtooth', 1200, 140, 0.35, 0.13); noise(0.3, 0.2, 8000, 800, 'highpass'); },
    bump: () => { tone('sine', 300, 600, 0.1, 0.12); tone('square', 600, 1200, 0.05, 0.04); },
    bonk: () => tone('triangle', 200, 120, 0.08, 0.08),
    freeze: () => { tone('sine', 3000, 600, 0.4, 0.08); noise(0.3, 0.08, 9000, 3000, 'highpass'); },
    shatter: () => { noise(0.4, 0.25, 9000, 1500, 'highpass'); [2400, 3100, 1900].forEach((f, i) => tone('triangle', f, f * 0.7, 0.12, 0.05, i * 0.03)); },
    shield: () => { tone('sine', 1200, 300, 0.25, 0.1); noise(0.15, 0.08, 5000, 1000, 'bandpass'); },
    clang: () => { tone('square', 1500, 1400, 0.08, 0.06); tone('triangle', 2300, 2000, 0.14, 0.05); },
    beep: () => tone('square', 1500, 1500, 0.06, 0.07),
    drop: () => tone('triangle', 300, 150, 0.12, 0.08),
    respawn: () => { [400, 600, 800].forEach((f, i) => tone('triangle', f, f, 0.08, 0.06, i * 0.05)); },
    sizzle: () => noise(0.15, 0.07, 6000, 2000, 'highpass'),
    count: () => tone('square', 440, 440, 0.12, 0.08),
    go: () => { tone('square', 880, 880, 0.25, 0.09); tone('square', 1320, 1320, 0.25, 0.05); },
    point: () => { tone('square', 990, 990, 0.06, 0.06); tone('square', 1480, 1480, 0.12, 0.06, 0.06); },
    lose: () => tone('square', 300, 150, 0.2, 0.06),
    sudden: () => { [0, 0.18, 0.36].forEach(d => tone('sawtooth', 220, 200, 0.14, 0.09, d)); },
    roundWin: () => { [523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, 0.12, 0.07, i * 0.09)); },
    matchWin: () => { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone('square', f, f, 0.16, 0.07, i * 0.11)); },
    tick: () => tone('triangle', 1200, 1200, 0.03, 0.04),
    ui: () => tone('triangle', 900, 1200, 0.05, 0.05),
  };

  function play(name) {
    if (!ctx || muted || !sounds[name]) return;
    const now = performance.now();
    if (now - (lastPlayed[name] || 0) < 35) return;
    lastPlayed[name] = now;
    try { sounds[name](); } catch (e) { }
  }
  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('sp-muted', m ? '1' : '0'); } catch (e) { }
    if (out) out.gain.value = m ? 0 : 0.45;
  }
  return { unlock, play, setMuted, get muted() { return muted; } };
})();
