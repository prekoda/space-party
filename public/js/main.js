// App shell: menus, local and online sessions, HUD, PWA install.
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const store = {
    get(k, d) { try { const v = localStorage.getItem('sp-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sp-' + k, JSON.stringify(v)); } catch (e) { } },
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const renderer = new Renderer($('#cv'));
  Input.init();
  MapStore.registerAll();

  let pid = sessionStorage.getItem('sp-pid');
  if (!pid) { pid = 'u' + Math.random().toString(36).slice(2, 12); sessionStorage.setItem('sp-pid', pid); }

  let mode = 'menu';          // 'menu' | 'local' | 'online'
  let attract = null, local = null, online = null, lobby = null;
  let curScreen = 'home';

  // ------------------------------------------------------------------ screens
  function show(id) {
    curScreen = id;
    $$('.screen').forEach(s => { s.hidden = s.id !== 'scr-' + id; });
    $('#menus').hidden = !id;
    $('#dim').classList.toggle('on', !!id && mode === 'menu');
    if (id) Sfx.unlock();
  }
  function toast(msg, ms = 2600) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms);
  }
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) {
      Sfx.unlock(); Sfx.play('ui');
      const to = go.dataset.go === 'home' && curScreen === 'editor' && editorFrom !== 'home' ? editorFrom : go.dataset.go;
      if (to === 'editor') editorFrom = curScreen;
      show(to);
      if (to === 'local') { refreshMapChips(); renderLocal(); }
      if (to === 'editor') editor.open();
      if (to === 'lobby') refreshMapChips();
    }
  });

  // ------------------------------------------------------------------ name & sound
  const nameIn = $('#in-name');
  nameIn.value = store.get('name', '');
  nameIn.addEventListener('input', () => store.set('name', nameIn.value.trim()));
  const myName = () => nameIn.value.trim() || 'Pilot' + Math.floor(Math.random() * 900 + 100);
  const muteBtn = $('#btn-mute');
  const syncMute = () => { muteBtn.textContent = Sfx.muted ? 'Sound: off' : 'Sound: on'; $('#btn-hud-mute').textContent = Sfx.muted ? '🔇' : '🔊'; };
  muteBtn.onclick = () => { Sfx.setMuted(!Sfx.muted); syncMute(); };
  $('#btn-hud-mute').onclick = () => { Sfx.setMuted(!Sfx.muted); syncMute(); };
  syncMute();
  const musicBtn = $('#btn-music');
  const syncMusic = () => { musicBtn.textContent = Sfx.music ? 'Music: on' : 'Music: off'; $('#btn-hud-music').classList.toggle('off', !Sfx.music); };
  musicBtn.onclick = () => { Sfx.setMusic(!Sfx.music); syncMusic(); };
  $('#btn-hud-music').onclick = () => { Sfx.setMusic(!Sfx.music); syncMusic(); };
  syncMusic();
  // Browsers only allow audio after a user gesture: unlock on the first touch/click/key.
  const unlockAudio = () => Sfx.unlock();
  addEventListener('pointerdown', unlockAudio, true);
  addEventListener('keydown', unlockAudio, true);
  Music.play('menu');

  // ------------------------------------------------------------------ local session
  class LocalSession {
    constructor(slots, settings, opts = {}) {
      this.game = new SP.Game();
      this.game.settings = { map: settings.map, target: settings.target };
      this.humans = [];
      slots.forEach((sl, i) => {
        const id = 'p' + i;
        if (sl.type === 'bot') this.game.addPlayer({ id, bot: sl.level, color: sl.color });
        else {
          const ctrl = new Controller();
          this.humans.push({ id, ctrl, color: sl.color });
          this.game.addPlayer({ id, name: sl.name, color: sl.color });
        }
      });
      this.humanIds = new Set(this.humans.map(h => h.id));
      this.acc = 0; this.paused = false; this.onEnd = opts.onEnd;
      this.game.startMatch();
      this.fr = this.build();
    }
    build() { const s = this.game.snapshot(); s.map = SP.MAP_BY_ID[s.map]; return s; }
    update(dt) {
      if (this.paused) return;
      this.acc += dt * 1000;
      let n = 0;
      const evs = [];
      while (this.acc >= SP.TICK_MS && n < 4) {
        this.acc -= SP.TICK_MS; n++;
        const inputs = {};
        for (const h of this.humans) inputs[h.id] = h.ctrl.sample();
        this.game.step(inputs);
        evs.push(...this.game.takeEvents());
        if (this.game.phase === 'lobby') { if (this.onEnd) this.onEnd(); return; }
      }
      if (n === 4) this.acc = 0;
      if (n) this.fr = this.build();
      const solo = this.humans.length === 1;
      for (const e of evs) renderer.fx(e, this.fr, solo && this.humanIds.has(e.id));
    }
  }

  function startAttract() {
    const lv = ['normal', 'hard', 'normal', 'easy'];
    attract = new LocalSession(lv.map((level, i) => ({ type: 'bot', level, color: SP.COLORS[(i * 2 + 1) % 6] })), { map: 'random', target: 5 }, { onEnd: () => { attract = null; } });
  }

  // ------------------------------------------------------------------ map & target pickers
  function buildChips(root, onPick) {
    root.innerHTML = '';
    const custom = MapStore.all().map(d => SP.MAP_BY_ID[d.id]).filter(Boolean);
    const opts = [{ id: 'random', name: 'Random' }, ...custom, ...SP.MAPS, { id: 'new', name: '+ New map' }];
    for (const m of opts) {
      const b = document.createElement('button');
      b.className = 'chip map' + (m.id.startsWith('c_') ? ' custom' : ''); b.dataset.v = m.id;
      if (m.id === 'random') b.innerHTML = `<div class="thumb rnd">?</div><span>Rotation</span>`;
      else if (m.id === 'new') b.innerHTML = `<div class="thumb rnd">+</div><span>New map</span>`;
      else {
        b.innerHTML = `<canvas class="thumb" width="128" height="80"></canvas><span></span>`;
        b.querySelector('span').textContent = (m.id.startsWith('c_') ? '★ ' : '') + m.name;
        drawMapThumb(b.querySelector('canvas'), m);
      }
      b.onclick = () => { Sfx.play('ui'); if (m.id === 'new') { editorFrom = curScreen; show('editor'); editor.newMap(); editor.open(); } else onPick(m.id); };
      root.appendChild(b);
    }
  }
  function refreshMapChips() {
    buildChips($('#local-maps'), id => { localSettings.map = id; renderLocal(); });
    buildChips($('#lobby-maps'), pickLobbyMap);
    if (!SP.MAP_BY_ID[localSettings.map] && localSettings.map !== 'random') localSettings.map = 'random';
    mark($('#local-maps'), localSettings.map);
    if (lobby) mark($('#lobby-maps'), lobby.settings.map);
  }
  function pickLobbyMap(id) {
    if (!online) return;
    if (id.startsWith('c_')) online.send('settings', { map: id, custom: MapStore.get(id) });
    else online.send('settings', { map: id });
  }
  function buildTargets(root, onPick) {
    root.innerHTML = '';
    for (const t of [5, 7, 10, 15]) {
      const b = document.createElement('button');
      b.className = 'chip num'; b.dataset.v = t; b.textContent = t;
      b.onclick = () => { Sfx.play('ui'); onPick(t); };
      root.appendChild(b);
    }
  }
  const mark = (root, v) => root.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.v === String(v)));

  // ------------------------------------------------------------------ local setup
  let slots = store.get('slots', null);
  if (!Array.isArray(slots) || !slots.length) slots = [{ type: 'human', color: SP.COLORS[0] }, { type: 'bot', level: 'normal', color: SP.COLORS[1] }];
  const localSettings = store.get('localSettings', { map: 'random', target: 10 });
  const touchChk = $('#chk-touch');
  // On by default only on phones/tablets; the toggle is a per-session override.
  touchChk.checked = Input.isTouch;

  buildTargets($('#local-target'), t => { localSettings.target = t; renderLocal(); });

  function freeColor(except) {
    const used = new Set(slots.filter(s => s !== except).map(s => s.color));
    return SP.COLORS.find(c => !used.has(c));
  }
  function renderLocal() {
    store.set('slots', slots); store.set('localSettings', localSettings);
    const ul = $('#local-players');
    ul.innerHTML = '';
    let hi = 0;
    slots.forEach((s, i) => {
      const li = document.createElement('li');
      const isHuman = s.type === 'human';
      const keys = isHuman ? KEYMAPS[hi] : null;
      const label = isHuman ? (hi === 0 && nameIn.value.trim() ? esc(nameIn.value.trim()) : `P${hi + 1}`) : 'Bot';
      li.innerHTML = `
        <button class="swatch" style="--c:${s.color}" title="Change color"></button>
        <span class="pname">${label}</span>
        ${isHuman ? `<span class="keys"><kbd>${keys.label[0]}</kbd> rotate <kbd>${keys.label[1]}</kbd> fire</span>`
          : `<button class="tag lvl">${s.level}</button>`}
        <button class="x" title="Remove">✕</button>`;
      li.querySelector('.swatch').onclick = () => {
        const used = new Set(slots.filter(o => o !== s).map(o => o.color));
        let k = SP.COLORS.indexOf(s.color);
        for (let n = 0; n < 6; n++) { k = (k + 1) % 6; if (!used.has(SP.COLORS[k])) { s.color = SP.COLORS[k]; break; } }
        Sfx.play('ui'); renderLocal();
      };
      if (!isHuman) li.querySelector('.lvl').onclick = () => {
        const L = ['easy', 'normal', 'hard'];
        s.level = L[(L.indexOf(s.level) + 1) % 3]; Sfx.play('ui'); renderLocal();
      };
      li.querySelector('.x').onclick = () => { slots.splice(i, 1); Sfx.play('ui'); renderLocal(); };
      if (isHuman) hi++;
      ul.appendChild(li);
    });
    const full = slots.length >= SP.MAX_PLAYERS;
    $('#btn-add-human').disabled = full; $('#btn-add-bot').disabled = full;
    $('#btn-local-start').disabled = slots.length < 2;
    mark($('#local-maps'), localSettings.map);
    mark($('#local-target'), localSettings.target);
  }
  $('#btn-add-human').onclick = () => {
    if (slots.length >= 6) return;
    const at = slots.findIndex(s => s.type === 'bot');
    const s = { type: 'human', color: freeColor() };
    if (at < 0) slots.push(s); else slots.splice(at, 0, s);
    Sfx.play('ui'); renderLocal();
  };
  $('#btn-add-bot').onclick = () => { if (slots.length < 6) { slots.push({ type: 'bot', level: 'normal', color: freeColor() }); Sfx.play('ui'); renderLocal(); } };

  $('#btn-local-start').onclick = () => {
    if (slots.length < 2) return;
    let hi = 0;
    const named = slots.map(s => s.type === 'human' ? Object.assign({}, s, { name: hi++ === 0 && nameIn.value.trim() ? nameIn.value.trim() : 'P' + hi }) : s);
    startLocal(named, localSettings);
  };
  function endLocal() {
    local = null;
    leaveGameUi();
    if (returnTo === 'editor') { returnTo = null; show('editor'); editor.open(); return; }
    show('local'); renderLocal();
  }
  function startLocal(named, settings) {
    local = new LocalSession(named, settings, { onEnd: endLocal });
    mode = 'local';
    Input.bind(local.humans.map(h => h.ctrl));
    Input.enabled = true;
    // Several people on one device: Astro Party corners. One person vs bots: big half-screen buttons.
    const multi = local.humans.length > 1;
    document.body.classList.toggle('touch-local', touchChk.checked && multi);
    if (!touchChk.checked) $('#touch').innerHTML = '';
    else if (multi) Input.buildTouchLocal($('#touch'), local.humans);
    else Input.buildTouchOnline($('#touch'), local.humans[0].ctrl, local.humans[0].color);
    enterGameUi();
  }

  let returnTo = null, editorFrom = 'home';
  const editor = new MapEditor({
    toast,
    onChange: refreshMapChips,
    onTest: def => {
      returnTo = 'editor';
      startLocal([{ type: 'human', color: SP.COLORS[0], name: nameIn.value.trim() || 'P1' }, { type: 'bot', level: 'normal', color: SP.COLORS[1] }], { map: def.id, target: 3 });
    },
  });

  // ------------------------------------------------------------------ online
  function ensureOnline() {
    if (online) return true;
    if (typeof io === 'undefined') { $('#online-err').textContent = "You're offline — online play needs a connection. Local Party works offline."; return false; }
    online = new OnlineSession(renderer, {
      onLobby, onKicked: msg => { toast(msg || 'You were removed from the room'); exitOnline(); show('online'); },
      onConnection: ok => { if (!ok && online && online.code) toast('Connection lost — reconnecting…', 4000); },
    });
    return true;
  }
  function busy(on) { $$('#scr-online .btn').forEach(b => { b.disabled = on; }); }
  $('#btn-create').onclick = () => {
    $('#online-err').textContent = '';
    if (!ensureOnline()) return;
    busy(true);
    online.create(myName(), pid, res => { busy(false); if (!res.ok) $('#online-err').textContent = res.error; else afterJoin(); });
  };
  const joinNow = () => {
    $('#online-err').textContent = '';
    const code = $('#in-code').value.trim().toUpperCase();
    if (code.length !== 4) { $('#online-err').textContent = 'Room codes are 4 letters'; return; }
    if (!ensureOnline()) return;
    busy(true);
    online.join(code, myName(), pid, res => { busy(false); if (!res.ok) $('#online-err').textContent = res.error; else afterJoin(); });
  };
  $('#btn-join').onclick = joinNow;
  $('#in-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinNow(); });
  $('#in-code').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  function afterJoin() {
    history.replaceState(null, '', '?room=' + online.code);
    if (lobby && lobby.phase === 'lobby') show('lobby');
  }

  buildTargets($('#lobby-target'), t => online && online.send('settings', { target: t }));
  refreshMapChips();
  $$('[data-bot]').forEach(b => { b.onclick = () => { Sfx.play('ui'); online.send('addBot', { level: b.dataset.bot }); }; });
  $('#btn-start').onclick = () => { Sfx.play('ui'); online.send('start'); };
  $('#btn-leave').onclick = () => { leaveRoom(); show('online'); };
  $('#btn-share').onclick = async () => {
    const url = location.origin + '/?room=' + online.code;
    try {
      if (navigator.share) await navigator.share({ title: 'Space Party', text: `Join my Space Party room ${online.code}`, url });
      else { await navigator.clipboard.writeText(url); toast('Invite link copied'); }
    } catch (e) { }
  };

  function leaveRoom() {
    if (!online) return;
    online.leave(); lobby = null;
    history.replaceState(null, '', '/');
    exitOnline();
  }
  function exitOnline() {
    if (mode === 'online') { mode = 'menu'; leaveGameUi(); }
    if (online) { online.inGame = false; online.code = null; online.reset(); }
  }

  function onLobby(st) {
    lobby = st;
    if (st.custom) { try { if (!SP.MAP_BY_ID[st.custom.id]) SP.registerMap(st.custom); } catch (e) { } }
    renderLobby(st);
    if (st.phase === 'lobby') {
      if (mode === 'online') { mode = 'menu'; online.inGame = false; online.reset(); leaveGameUi(); }
      if (curScreen !== 'lobby' && online.code) show('lobby');
    } else if (mode !== 'online') {
      mode = 'online';
      online.reset(); online.inGame = true;
      const me = st.players.find(p => p.id === online.me);
      Input.bind([online.ctrl]); Input.enabled = true;
      if (Input.isTouch) Input.buildTouchOnline($('#touch'), online.ctrl, me ? me.color : '#fff');
      else $('#touch').innerHTML = '';
      enterGameUi();
    }
  }

  function renderLobby(st) {
    if (!online) return;
    const me = online.me, host = st.host === me;
    $('#lobby-code').textContent = st.code;
    const ul = $('#lobby-players');
    ul.innerHTML = '';
    for (const p of st.players) {
      const li = document.createElement('li');
      const isMe = p.id === me;
      li.innerHTML = `
        <button class="swatch" style="--c:${p.color}" ${isMe ? 'title="Change color"' : 'disabled'}></button>
        <span class="pname">${esc(p.name)}</span>
        ${p.id === st.host ? '<span class="tag host">HOST</span>' : ''}
        ${p.bot ? `<span class="tag">${p.bot} bot</span>` : ''}
        ${isMe ? '<span class="tag you">YOU</span>' : ''}
        ${p.away ? '<span class="tag away">reconnecting</span>' : ''}
        ${host && !isMe ? '<button class="x" title="Remove">✕</button>' : ''}`;
      if (isMe) li.querySelector('.swatch').onclick = () => { Sfx.play('ui'); online.send('color'); };
      const x = li.querySelector('.x');
      if (x) x.onclick = () => { Sfx.play('ui'); online.send('kick', p.id); };
      ul.appendChild(li);
    }
    for (let i = st.players.length; i < SP.MAX_PLAYERS; i++) {
      const li = document.createElement('li'); li.className = 'empty';
      li.innerHTML = '<span class="swatch"></span><span class="pname">Open slot</span>';
      ul.appendChild(li);
    }
    $('#lobby-host').hidden = !host;
    $$('[data-bot]').forEach(b => { b.disabled = st.players.length >= SP.MAX_PLAYERS; });
    $('#btn-start').hidden = !host;
    $('#btn-start').disabled = st.players.length < 2;
    const hostName = (st.players.find(p => p.id === st.host) || {}).name || 'host';
    $('#lobby-wait').textContent = host
      ? (st.players.length < 2 ? 'Share the code or add a bot to start' : `${st.players.length} pilots ready`)
      : `Waiting for ${hostName} to start… (map: ${st.settings.map === 'random' ? 'Rotation' : (SP.MAP_BY_ID[st.settings.map] || { name: 'Custom' }).name}, first to ${st.settings.target})`;
    mark($('#lobby-maps'), st.settings.map);
    mark($('#lobby-target'), st.settings.target);
  }

  // ------------------------------------------------------------------ in-game UI
  let wakeLock = null;
  function enterGameUi() {
    show(null);
    $('#dim').classList.remove('on');
    document.body.classList.add('ingame');
    $('#hud').hidden = false;
    $('#hud-room').textContent = mode === 'online' ? 'ROOM ' + online.code : '';
    lastScoreKey = '';
    renderer.parts = [];
    renderer.setHud(true);
    Music.play('battle');
    if (Input.isTouch) {
      const el = document.documentElement;
      const lock = () => { try { window.screen.orientation.lock('landscape').catch(() => { }); } catch (e) { } };
      if (!document.fullscreenElement && el.requestFullscreen && !matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches) {
        el.requestFullscreen({ navigationUI: 'hide' }).then(lock).catch(() => { });
      } else lock();
    }
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { wakeLock = l; }).catch(() => { }); } catch (e) { }
  }
  function leaveGameUi() {
    document.body.classList.remove('ingame', 'touch-local');
    renderer.setHud(false);
    Music.play('menu'); Music.setIntensity(1);
    $('#hud').hidden = true; $('#spectate').hidden = true;
    $('#touch').innerHTML = '';
    Input.enabled = false; Input.bind([]);
    if (wakeLock) { wakeLock.release().catch(() => { }); wakeLock = null; }
  }

  function pause() {
    if (mode === 'menu') return;
    if (mode === 'local') local.paused = true;
    const host = mode === 'online' && lobby && lobby.host === online.me;
    $('#btn-end').hidden = !(mode === 'local' || host);
    $('#btn-quit').textContent = mode === 'online' ? 'Leave room' : 'Quit to menu';
    $('#pause-note').textContent = mode === 'online' ? 'The match keeps running while this is open.' : '';
    show('pause');
    $('#dim').classList.add('on');
  }
  function resume() {
    if (mode === 'local' && local) local.paused = false;
    show(null); $('#dim').classList.remove('on');
  }
  $('#btn-pause').onclick = pause;
  $('#btn-resume').onclick = resume;
  $('#btn-end').onclick = () => {
    if (mode === 'local') { endLocal(); return; }
    online.send('endMatch'); resume();
  };
  $('#btn-quit').onclick = () => {
    if (mode === 'local') { local = null; mode = 'menu'; leaveGameUi(); if (returnTo === 'editor') { returnTo = null; show('editor'); editor.open(); } else show('home'); return; }
    leaveRoom(); show('home');
  };
  addEventListener('keydown', e => {
    if (e.key === 'Escape' || (e.key === 'p' && mode === 'online')) {
      if (mode === 'menu') return;
      if (curScreen === 'pause') resume(); else pause();
    }
  });

  let lastScoreKey = '';
  function updateHud(fr) {
    if (mode === 'menu' || !fr) return;
    const key = fr.pl.map(p => p.id + p.c + p.s).join('|') + fr.tg;
    if (key !== lastScoreKey) {
      lastScoreKey = key;
      $('#scorebar').innerHTML = fr.pl.map(p => `<span class="sc" style="--c:${p.c}"><i></i>${esc(p.n)}<b>${p.s}</b></span>`).join('') + `<span class="tgt">to ${fr.tg}</span>`;
    }
    if (mode === 'online') {
      $('#hud-ping').textContent = online.ping ? online.ping + ' ms' : '';
      const live = fr.ph === 'countdown' || fr.ph === 'play' || fr.ph === 'roundEnd';
      $('#spectate').hidden = !(live && !fr.sh.some(s => s.id === online.me));
    }
  }

  // ------------------------------------------------------------------ help screen icons
  $$('[data-icon]').forEach(c => {
    const g = c.getContext('2d'), t = c.dataset.icon, P = SP.POWERS[t];
    g.translate(c.width / 2, c.height / 2);
    g.fillStyle = '#0b0d1c'; g.strokeStyle = P.color; g.lineWidth = 3;
    g.beginPath(); g.arc(0, 0, c.width / 2 - 3, 0, SP.TAU); g.fill(); g.stroke();
    drawPowerIcon(g, t, c.width / 4, P.color);
  });

  // ------------------------------------------------------------------ PWA
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { }));
  let deferredInstall = null;
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; $('#btn-install').hidden = false; });
  $('#btn-install').onclick = async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => { });
    deferredInstall = null; $('#btn-install').hidden = true;
  };
  addEventListener('appinstalled', () => { $('#btn-install').hidden = true; toast('Installed! Launch Space Party from your home screen.'); });
  const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone) $('#ios-hint').hidden = false;

  // ------------------------------------------------------------------ boot
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam) {
    $('#in-code').value = roomParam.toUpperCase().slice(0, 4);
    show('online');
    if (nameIn.value.trim()) joinNow();
  } else show('home');

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
    let fr = null, opts = {};
    if (mode === 'online' && online) {
      online.update(dt);
      fr = online.frame();
      opts = { me: online.me, names: true, overHint: 'Back to the lobby in a moment…' };
    } else if (mode === 'local' && local) {
      local.update(dt * renderer.timeScale());
      fr = local && local.fr;
      if (local) opts = { localRev: local.humanIds };
    } else {
      if (!attract) startAttract();
      attract.update(dt);
      fr = attract && attract.fr;
    }
    renderer.silent = mode === 'menu';
    if (mode !== 'menu' && fr) {
      const paused = mode === 'local' && local && local.paused;
      Music.setIntensity(paused || fr.ph === 'scores' || fr.ph === 'over' || fr.ph === 'roundEnd' ? 0 : fr.sd ? 2 : 1);
    }
    renderer.draw(fr, dt, opts);
    updateHud(fr);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
