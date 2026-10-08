// Map editor: paint a 32×20 tile grid, pick a theme and symmetry, save maps on this device.
const MapStore = {
  KEY: 'sp-maps',
  all() {
    try {
      const a = JSON.parse(localStorage.getItem(this.KEY) || '[]');
      return Array.isArray(a) ? a.filter(d => SP.validateMapDef(d)) : [];
    } catch (e) { return []; }
  },
  save(def) {
    const a = this.all().filter(d => d.id !== def.id);
    a.push(def);
    try { localStorage.setItem(this.KEY, JSON.stringify(a)); } catch (e) { }
    SP.registerMap(def);
  },
  remove(id) {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.all().filter(d => d.id !== id))); } catch (e) { }
  },
  get(id) { return this.all().find(d => d.id === id) || null; },
  registerAll() { for (const d of this.all()) { try { SP.registerMap(d); } catch (e) { } } },
};

const EDITOR_TOOLS = [
  { ch: '#', name: 'Wall' }, { ch: 'b', name: 'Block' }, { ch: '~', name: 'Hazard' }, { ch: 'o', name: 'Bumper' },
  { ch: 'A', name: 'Asteroid' }, { ch: 'P', name: 'Spawn' }, { ch: '*', name: 'Sun' }, { ch: 'X', name: 'Spinner' },
  { ch: 'V', name: 'Crate spot' }, { ch: '.', name: 'Erase' },
];
const SINGLETONS = '*XV';

class MapEditor {
  constructor(opts) {
    this.opts = opts;
    this.cv = document.getElementById('ed-canvas');
    this.g = this.cv.getContext('2d');
    this.tool = '#';
    this.sym = 'xy';
    this.newMap();

    const tools = document.getElementById('ed-tools');
    for (const t of EDITOR_TOOLS) {
      const b = document.createElement('button');
      b.className = 'chip tool'; b.dataset.ch = t.ch; b.innerHTML = `<i class="sw" data-t="${t.ch}"></i>${t.name}`;
      b.onclick = () => { this.tool = t.ch; this.syncUi(); Sfx.play('ui'); };
      tools.appendChild(b);
    }
    const theme = document.getElementById('ed-theme');
    for (const id of SP.THEME_IDS) { const o = document.createElement('option'); o.value = id; o.textContent = THEMES[id].name; theme.appendChild(o); }
    theme.onchange = () => { this.theme = theme.value; this.render(); };
    const sym = document.getElementById('ed-sym');
    sym.onchange = () => { this.sym = sym.value; };
    document.getElementById('ed-name').oninput = e => { this.name = e.target.value.slice(0, 20); };
    document.getElementById('ed-clear').onclick = () => { if (confirm('Clear the whole map?')) { this.rows = this.blank(); this.render(); } };
    document.getElementById('ed-new').onclick = () => { this.newMap(); this.syncUi(); this.render(); };
    document.getElementById('ed-save').onclick = () => this.save();
    document.getElementById('ed-test').onclick = () => { const d = this.save(); if (d) this.opts.onTest(d); };
    document.getElementById('ed-del').onclick = () => {
      if (!MapStore.get(this.id) || !confirm(`Delete "${this.name}"?`)) return;
      MapStore.remove(this.id); this.newMap(); this.syncUi(); this.render(); this.renderList(); this.opts.onChange();
    };

    let painting = null;
    const cell = e => {
      const r = this.cv.getBoundingClientRect();
      return [Math.floor((e.clientX - r.left) / r.width * SP.GC), Math.floor((e.clientY - r.top) / r.height * SP.GR)];
    };
    this.cv.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.cv.setPointerCapture(e.pointerId);
      const [x, y] = cell(e);
      if (x < 0 || y < 0 || x >= SP.GC || y >= SP.GR) return;
      // Painting over the same tile erases instead, so one tool can add and remove.
      painting = SINGLETONS.includes(this.tool) || this.tool === '.' ? this.tool : (this.rows[y][x] === this.tool ? '.' : this.tool);
      this.paint(x, y, painting);
    });
    this.cv.addEventListener('pointermove', e => {
      if (!painting || SINGLETONS.includes(painting)) return;
      const [x, y] = cell(e);
      if (x >= 0 && y >= 0 && x < SP.GC && y < SP.GR) this.paint(x, y, painting);
    });
    const stop = () => { painting = null; };
    this.cv.addEventListener('pointerup', stop);
    this.cv.addEventListener('pointercancel', stop);
  }

  blank() { return Array.from({ length: SP.GR }, () => Array(SP.GC).fill('.')); }
  newMap() {
    this.id = 'c_' + Math.random().toString(36).slice(2, 10);
    this.name = 'My Map';
    this.theme = 'space';
    this.rows = this.blank();
    // start with something to edit: corner spawns
    for (const [x, y] of [[1, 1], [30, 18], [30, 1], [1, 18]]) this.rows[y][x] = 'P';
  }
  load(def) {
    this.id = def.id; this.name = def.name; this.theme = def.theme;
    this.rows = def.grid.map(r => [...r]);
    this.syncUi(); this.render();
  }
  open() { this.syncUi(); this.render(); this.renderList(); }

  paint(x, y, ch) {
    const R = this.rows;
    if (SINGLETONS.includes(ch)) {
      for (const row of R) for (let i = 0; i < row.length; i++) if (row[i] === ch) row[i] = '.';
      R[y][x] = ch;
    } else {
      const cells = [[x, y]];
      const mx = SP.GC - 1 - x, my = SP.GR - 1 - y;
      if (this.sym === 'x' || this.sym === 'xy') cells.push([mx, y]);
      if (this.sym === 'y' || this.sym === 'xy') cells.push([x, my]);
      if (this.sym === 'xy') cells.push([mx, my]);
      for (const [cx, cy] of cells) {
        if (ch === 'P' && R[cy][cx] !== 'P' && R.flat().filter(c => c === 'P').length >= 8) continue;
        R[cy][cx] = ch;
      }
    }
    this.render();
  }

  toDef() { return { id: this.id, name: (this.name || 'My Map').trim().slice(0, 20) || 'My Map', theme: this.theme, grid: this.rows.map(r => r.join('')) }; }
  save() {
    const d = this.toDef();
    if (!SP.validateMapDef(d)) { alert('This map could not be saved.'); return null; }
    MapStore.save(d);
    this.renderList(); this.opts.onChange();
    this.opts.toast('Saved "' + d.name + '"');
    return d;
  }

  syncUi() {
    document.getElementById('ed-name').value = this.name;
    document.getElementById('ed-theme').value = this.theme;
    document.getElementById('ed-sym').value = this.sym;
    document.querySelectorAll('#ed-tools .chip').forEach(b => b.classList.toggle('on', b.dataset.ch === this.tool));
    document.getElementById('ed-del').disabled = !MapStore.get(this.id);
  }

  renderList() {
    const list = document.getElementById('ed-list');
    list.innerHTML = '';
    const maps = MapStore.all();
    if (!maps.length) { list.innerHTML = '<span class="hint">No saved maps yet.</span>'; return; }
    for (const d of maps) {
      const b = document.createElement('button');
      b.className = 'chip map' + (d.id === this.id ? ' on' : '');
      b.innerHTML = `<canvas class="thumb" width="128" height="80"></canvas><span></span>`;
      b.querySelector('span').textContent = d.name;
      drawMapThumb(b.querySelector('canvas'), SP.MAP_BY_ID[d.id] || SP.buildGridMap(d));
      b.onclick = () => { this.load(d); this.renderList(); Sfx.play('ui'); };
      list.appendChild(b);
    }
  }

  render() {
    const g = this.g, cs = this.cv.width / SP.GC, T = THEMES[this.theme] || THEMES.space;
    g.fillStyle = T.bg; g.fillRect(0, 0, this.cv.width, this.cv.height);
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1;
    g.beginPath();
    for (let x = 1; x < SP.GC; x++) { g.moveTo(x * cs + 0.5, 0); g.lineTo(x * cs + 0.5, this.cv.height); }
    for (let y = 1; y < SP.GR; y++) { g.moveTo(0, y * cs + 0.5); g.lineTo(this.cv.width, y * cs + 0.5); }
    g.stroke();
    // symmetry guides
    g.strokeStyle = 'rgba(127,178,255,0.35)';
    g.beginPath(); g.moveTo(this.cv.width / 2, 0); g.lineTo(this.cv.width / 2, this.cv.height); g.moveTo(0, this.cv.height / 2); g.lineTo(this.cv.width, this.cv.height / 2); g.stroke();
    let spinner = null, sun = null;
    for (let y = 0; y < SP.GR; y++) for (let x = 0; x < SP.GC; x++) {
      const ch = this.rows[y][x], px = x * cs, py = y * cs, cx = px + cs / 2, cy = py + cs / 2;
      switch (ch) {
        case '#': g.fillStyle = T.wall[1]; g.fillRect(px, py, cs, cs); g.fillStyle = T.wall[0]; g.fillRect(px + 3, py + 3, cs - 6, cs - 6); break;
        case 'b': g.fillStyle = T.block[0]; g.fillRect(px, py, cs, cs); g.fillStyle = T.block[2]; g.fillRect(px + 2, py + 2, cs - 4, cs - 4); break;
        case '~': g.fillStyle = T.hz[0]; g.fillRect(px, py, cs, cs); g.fillStyle = T.hz[1]; g.fillRect(px + 4, py + 6, 3, 2); break;
        case 'o': g.fillStyle = '#ff4dd8'; g.beginPath(); g.arc(cx, cy, cs * 0.6, 0, SP.TAU); g.fill(); break;
        case 'A': g.fillStyle = '#8a8fa8'; g.beginPath(); g.arc(cx, cy, cs * 1.05, 0, SP.TAU); g.fill(); break;
        case 'P': g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(cx, py + 3); g.lineTo(px + cs - 3, py + cs - 3); g.lineTo(px + 3, py + cs - 3); g.fill(); break;
        case 'V': g.fillStyle = '#ffd23f'; g.fillRect(px + 3, py + 3, cs - 6, cs - 6); g.fillStyle = '#4a3208'; g.fillRect(px + 7, py + 7, cs - 14, cs - 14); break;
        case '*': sun = [cx, cy]; break;
        case 'X': spinner = [cx, cy]; break;
      }
    }
    if (sun) { g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(sun[0], sun[1], cs * 1.1, 0, SP.TAU); g.fill(); g.strokeStyle = 'rgba(255,140,46,0.5)'; g.lineWidth = 2; g.beginPath(); g.arc(sun[0], sun[1], cs * 3.5, 0, SP.TAU); g.stroke(); }
    if (spinner) {
      const L = 320 / SP.CELL * cs / 2;
      g.strokeStyle = T.wall[1]; g.lineWidth = cs * 0.4;
      g.beginPath(); g.moveTo(spinner[0] - L, spinner[1]); g.lineTo(spinner[0] + L, spinner[1]); g.moveTo(spinner[0], spinner[1] - L); g.lineTo(spinner[0], spinner[1] + L); g.stroke();
      g.setLineDash([4, 4]); g.lineWidth = 1; g.beginPath(); g.arc(spinner[0], spinner[1], L, 0, SP.TAU); g.stroke(); g.setLineDash([]);
    }
    // palette swatches on tool buttons
    document.querySelectorAll('#ed-tools .sw').forEach(sw => {
      const t = sw.dataset.t;
      sw.style.background = t === '#' ? T.wall[1] : t === 'b' ? T.block[2] : t === '~' ? T.hz[0] : t === 'o' ? '#ff4dd8' : t === 'A' ? '#8a8fa8' : t === 'P' ? '#ffffff' : t === '*' ? '#ffd23f' : t === 'X' ? T.wall[1] : t === 'V' ? '#ffd23f' : 'transparent';
    });
  }
}
