const socket = io(window.location.origin);

// DOM Elements
const startScreen = document.getElementById('start-screen');
const gameScreen = document.getElementById('game-screen');
const playerNameInput = document.getElementById('playerName');
const roomCodeInput = document.getElementById('roomCode');
const joinBtn = document.getElementById('joinBtn');
const colorOptions = document.querySelectorAll('.color-option');
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const currentRoomCodeSpan = document.getElementById('currentRoomCode');
const scoreList = document.getElementById('scoreList');
const timerDisplay = document.getElementById('timerDisplay');
const hudHearts = [document.getElementById('heart-0'), document.getElementById('heart-1'), document.getElementById('heart-2')];
const dashBar = document.getElementById('dash-bar');
const dashStatus = document.getElementById('dash-status');
const hudWeapon = document.getElementById('active-weapon');
const hudAmmo = document.getElementById('weapon-ammo');

// Game State
let myId = null;

const SERVER_TICK_MS = 1000 / 60;
let prevState = { players: {}, bullets: [], walls: [], boxes: [], droppedPowerups: [], mines: [], state: 'PLAYING', timeRemaining: 0 };
let targetState = { players: {}, bullets: [], walls: [], boxes: [], droppedPowerups: [], mines: [], state: 'PLAYING', timeRemaining: 0 };
let lastUpdateTime = Date.now();

// Convenience reference for non-interpolated data (walls, powerup, leaderboard, etc.)
let roomState = targetState;

let selectedColor = '#00ffcc';
let particles = [];
let stars = [];
let gameOverData = null;

// Dash cooldown tracked client-side
const MY_DASH_COOLDOWN_MS = 1500;
let myDashCooldownUntil = 0;
let shakeIntensity = 0;
let laserBeams = [];

// Initialize stars
for (let i = 0; i < 150; i++) {
    stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 2,
        speed: Math.random() * 0.5 + 0.1
    });
}

// Color Selection
colorOptions.forEach(option => {
    option.addEventListener('click', () => {
        colorOptions.forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        selectedColor = option.dataset.color;
        option.style.boxShadow = `0 0 15px ${selectedColor}`;
        colorOptions.forEach(opt => {
            if (opt !== option) opt.style.boxShadow = 'none';
        });
    });
});
colorOptions[1].click();

// Join Game
joinBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim() || 'Pilot_' + Math.floor(Math.random() * 1000);
    let room = roomCodeInput.value.trim();
    if (!room) {
        room = Math.random().toString(36).substring(2, 6).toUpperCase();
    }

    socket.emit('joinRoom', { roomId: room, name, color: selectedColor });
    startScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    currentRoomCodeSpan.textContent = room;

    requestAnimationFrame(gameLoop);
});

// ─── Mouse Controls ───────────────────────────────────────────────────────────

// Prevent browser context menu on canvas
canvas.addEventListener('contextmenu', e => e.preventDefault());

let rightHeld = false;          // right mouse button held → rotate clockwise
let lastRightClick = 0;         // timestamp of previous right-click for double-click detection
const DOUBLE_CLICK_MS = 300;    // window for double-right-click → dash

canvas.addEventListener('mousedown', e => {
    if (e.button === 0) {
        // Left click → shoot
        socket.emit('shoot');
    } else if (e.button === 2) {
        // Right click → rotate; detect double-click for dash
        const now = Date.now();
        if (now - lastRightClick <= DOUBLE_CLICK_MS) {
            socket.emit('dash');
            myDashCooldownUntil = Date.now() + MY_DASH_COOLDOWN_MS;
            lastRightClick = 0; // reset so triple-click doesn't re-dash immediately
        } else {
            lastRightClick = now;
        }
        rightHeld = true;
    }
});

canvas.addEventListener('mouseup', e => {
    if (e.button === 2) rightHeld = false;
});

// Safety: if mouse leaves window while held, release rotation
window.addEventListener('mouseup', e => {
    if (e.button === 2) rightHeld = false;
});

// Input Sync Loop – send rotation state to server at 60 Hz
setInterval(() => {
    socket.emit('input', { turn: rightHeld });
}, 1000 / 60);

// ─── Socket Listeners ─────────────────────────────────────────────────────────

socket.on('connect', () => {
    myId = socket.id;
});

socket.on('update', (state) => {
    // Slide the window: previous target becomes the new prev, new data → target
    prevState = deepCloneState(targetState);
    targetState = state;
    lastUpdateTime = Date.now();

    roomState = targetState; // keep convenience ref up to date

    updateLeaderboard();

    if (timerDisplay) {
        const totalSeconds = Math.floor(state.timeRemaining / 1000);
        const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        timerDisplay.textContent = `${m}:${s}`;
    }
});

socket.on('hit', ({ x, y, targetId }) => {
    const hitColor = roomState.players[targetId] ? roomState.players[targetId].color : '#fff';
    spawnParticles(x, y, hitColor, 20);
    addShake(5);
});

socket.on('powerupCollected', ({ x, y, type, pid }) => {
    const color = POWERUP_COLORS[type] || '#ff9900';
    spawnParticles(x, y, color, 30);
    // Remove floating text for Jouster as requested
    if (type !== 'jouster') {
        spawnFloatingText(x, y - 20, type.toUpperCase(), color);
    }
    addShake(4);
});

socket.on('boxHit', ({ x, y }) => {
    spawnParticles(x, y, '#aaa', 5);
});

socket.on('boxBroken', ({ x, y }) => {
    spawnParticles(x, y, '#fff', 40);
    addShake(8);
});

socket.on('missileExploded', ({ x, y }) => {
    spawnParticles(x, y, POWERUP_COLORS['missiles'], 50);
    addShake(20);
});

socket.on('mineExploded', ({ x, y }) => {
    spawnParticles(x, y, POWERUP_COLORS['mine'], 80);
    addShake(25);
});

socket.on('mineTriggered', () => {
    addShake(10);
});

let slashes = [];
socket.on('superDashKill', ({ x, y, targetType }) => {
    const intensity = targetType === 'player' ? 50 : 25;
    addShake(intensity);
    slashes.push({ x, y, life: 1.0, angle: Math.random() * Math.PI * 2 });
    spawnParticles(x, y, '#fff', 60);
});

socket.on('laserFired', ({ startX, startY, endX, endY, color }) => {
    // Intense piercing laser visual
    spawnLaserBeam(startX, startY, endX, endY, '#fff'); // White core
    spawnLaserBeam(startX, startY, endX, endY, color);    // Colored glow
    addShake(20);
});

let parries = [];
socket.on('parry', ({ x, y, color }) => {
    parries.push({ x, y, color, life: 1.0 });
});

socket.on('respawnFlash', ({ x, y, color }) => {
    addShake(30);
    spawnParticles(x, y, '#fff', 50);
    spawnParticles(x, y, color, 30);
});

socket.on('gameOver', (data) => {
    gameOverData = data;
    setTimeout(() => { gameOverData = null; }, 5000);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Deep clone just the fields we interpolate */
function deepCloneState(s) {
    const clonedPlayers = {};
    for (const id in s.players) {
        const p = s.players[id];
        clonedPlayers[id] = { ...p };
    }
    return {
        players: clonedPlayers,
        bullets: s.bullets ? s.bullets.map(b => ({ ...b })) : [],
        walls: s.walls,
        boxes: s.boxes ? s.boxes.map(b => ({ ...b })) : [],
        droppedPowerups: s.droppedPowerups ? s.droppedPowerups.map(p => ({ ...p })) : [],
        mines: s.mines ? s.mines.map(m => ({ ...m })) : [],
        state: s.state,
        timeRemaining: s.timeRemaining
    };
}

/** Linear interpolation */
function lerp(a, b, t) { return a + (b - a) * t; }

/** Shortest-path angle interpolation */
function lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
}

function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        const speed = Math.random() * 5 + 2;
        const angle = Math.random() * Math.PI * 2;
        particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1.0,
            color: color
        });
    }
}

function spawnLaserBeam(startX, startY, endX, endY, color) {
    laserBeams.push({ startX, startY, endX, endY, color, life: 1.0 });
}

let floatingTexts = [];
function spawnFloatingText(x, y, text, color) {
    floatingTexts.push({ x, y, text, color, life: 1.0, vy: -1.5 });
}

function addShake(intensity) {
    shakeIntensity = Math.max(shakeIntensity, intensity);
}

/** Draw small HP diamond pips above a player's name label */
function drawHpPips(x, y, hp, maxHp, color) {
    const pipSize = 6;
    const gap = 10;
    const totalW = maxHp * pipSize + (maxHp - 1) * (gap - pipSize);
    const startX = x - totalW / 2;
    for (let i = 0; i < maxHp; i++) {
        const px = startX + i * gap;
        const py = y - 58;
        ctx.save();
        ctx.beginPath();
        // diamond
        ctx.moveTo(px, py - pipSize / 2);
        ctx.lineTo(px + pipSize / 2, py);
        ctx.lineTo(px, py + pipSize / 2);
        ctx.lineTo(px - pipSize / 2, py);
        ctx.closePath();
        if (i < hp) {
            ctx.fillStyle = color;
            ctx.shadowBlur = 8;
            ctx.shadowColor = color;
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.shadowBlur = 0;
        }
        ctx.fill();
        ctx.restore();
    }
}

/** Update the HTML HUD for the local player */
function updateHUD() {
    if (!myId) return;
    const me = targetState.players[myId];
    const hp = me ? (me.hp ?? 3) : 3;
    const maxHp = me ? (me.maxHp ?? 3) : 3;

    // Hearts
    hudHearts.forEach((el, i) => {
        if (!el) return;
        el.classList.toggle('active', i < hp);
        el.classList.toggle('lost', i >= hp);
    });

    // Dash bar
    const now = Date.now();
    const remaining = Math.max(0, myDashCooldownUntil - now);
    const pct = 1 - remaining / MY_DASH_COOLDOWN_MS;
    if (dashBar) dashBar.style.width = (pct * 100) + '%';
    if (dashStatus) {
        if (remaining <= 0) {
            dashStatus.textContent = 'READY';
            dashStatus.className = 'dash-ready';
        } else {
            dashStatus.textContent = (remaining / 1000).toFixed(1) + 's';
            dashStatus.className = 'dash-cooldown';
        }
    }

    // Weapon
    if (hudWeapon && hudAmmo) {
        if (me && me.activePowerup) {
            const pw = me.activePowerup;
            hudWeapon.textContent = pw.type.toUpperCase();
            hudWeapon.style.color = POWERUP_COLORS[pw.type] || '#fff';
            hudWeapon.style.textShadow = `0 0 8px ${POWERUP_COLORS[pw.type] || '#fff'}`;
            if (pw.type === 'jouster') {
                const remS = Math.max(0, (pw.endTime - now) / 1000).toFixed(1);
                hudAmmo.textContent = `${remS}s`;
            } else {
                hudAmmo.textContent = `${pw.ammo} AMMO`;
            }
        } else {
            hudWeapon.textContent = 'NORMAL';
            hudWeapon.style.color = '#fff';
            hudWeapon.style.textShadow = '0 0 8px rgba(255,255,255,0.5)';
            hudAmmo.innerHTML = '&#8734;';
        }
    }
}

function updateLeaderboard() {
    const players = Object.values(roomState.players).sort((a, b) => b.score - a.score);
    if (!scoreList) return;
    scoreList.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.style.color = p.color;
        li.innerHTML = `<span>${p.name}</span> <span>${p.score}</span>`;
        scoreList.appendChild(li);
    });
}

// ─── Draw Functions ───────────────────────────────────────────────────────────

function drawPilot(x, y, angle, color, drawAlpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = drawAlpha;

    // Body (small astronaut suit)
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Visor
    ctx.beginPath();
    ctx.ellipse(3, 0, 4, 6, Math.PI / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.strokeStyle = '#00aaff';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Small backpack
    ctx.fillStyle = '#666';
    ctx.fillRect(-10, -5, 4, 10);

    ctx.restore();
}

function drawTriangle(x, y, angle, color, isHit, alpha = 1.0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha;

    if (isHit) {
        ctx.strokeStyle = '#fff';
        ctx.setLineDash([2, 4]);
        ctx.lineWidth = 1;
    } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 15;
        ctx.shadowColor = color;
    }

    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-15, 12);
    ctx.lineTo(-10, 0);
    ctx.lineTo(-15, -12);
    ctx.closePath();
    ctx.stroke();

    if (!isHit) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.3 * alpha;
        ctx.fill();
    }
    ctx.restore();
}

function drawBulletsIndicator(x, y, bullets, time, color = '#fff') {
    ctx.save();
    ctx.translate(x, y);
    const radius = 35;
    for (let i = 0; i < bullets; i++) {
        const angle = -time * 0.003 + (i * ((Math.PI * 2) / 3));
        const bx = Math.cos(angle) * radius;
        const by = Math.sin(angle) * radius;

        ctx.beginPath();
        ctx.arc(bx, by, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = color;
        ctx.fill();
        ctx.closePath();
    }
    ctx.restore();
}

function drawStars() {
    ctx.fillStyle = '#fff';
    stars.forEach(s => {
        ctx.globalAlpha = Math.random() * 0.5 + 0.3;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
        s.y += s.speed;
        if (s.y > canvas.height) s.y = 0;
    });
    ctx.globalAlpha = 1.0;
}

function drawWalls() {
    ctx.save();
    roomState.walls.forEach(w => {
        ctx.fillStyle = 'rgba(20, 20, 50, 0.8)';
        ctx.shadowColor = '#33ccff';
        ctx.shadowBlur = 10;
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.strokeStyle = '#33ccff';
        ctx.lineWidth = 2;
        ctx.strokeRect(w.x, w.y, w.w, w.h);
    });
    ctx.restore();
}

function drawBoxes() {
    ctx.save();
    roomState.boxes.forEach(b => {
        ctx.fillStyle = 'rgba(50, 50, 50, 0.8)';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.shadowBlur = 5;
        ctx.shadowColor = '#fff';

        ctx.fillRect(b.x - b.size / 2, b.y - b.size / 2, b.size, b.size);
        ctx.strokeRect(b.x - b.size / 2, b.y - b.size / 2, b.size, b.size);

        // draw HP pips inside box
        ctx.fillStyle = '#ff3366';
        ctx.shadowBlur = 0;
        const gap = 6;
        const startX = b.x - (b.hp - 1) * gap / 2;
        for (let i = 0; i < b.hp; i++) {
            ctx.beginPath();
            ctx.arc(startX + i * gap, b.y, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    });
    ctx.restore();
}

const POWERUP_COLORS = {
    laser: '#ff3366',
    missiles: '#ff9900',
    shield: '#00ffcc',
    scatter: '#ffff00',
    mine: '#ff0000',
    jouster: '#cc33ff',
    reverse: '#00ff00',
    superdash: '#ffffff'
};

function drawDroppedPowerups(time) {
    ctx.save();
    roomState.droppedPowerups.forEach(dp => {
        const pulse = Math.sin(time * 0.005) * 3;
        const color = POWERUP_COLORS[dp.type] || '#fff';

        ctx.beginPath();
        ctx.arc(dp.x, dp.y, 12 + pulse, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.shadowBlur = 15 + pulse * 2;
        ctx.shadowColor = color;
        ctx.fill();
        ctx.closePath();

        // Inner core
        ctx.beginPath();
        ctx.arc(dp.x, dp.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.closePath();

        // Label
        ctx.fillStyle = '#fff';
        ctx.font = '10px Orbitron';
        ctx.textAlign = 'center';
        ctx.shadowBlur = 0;
        ctx.fillText(dp.type.toUpperCase(), dp.x, dp.y - 20 - pulse);
    });
    ctx.restore();
}

function drawMines(time) {
    if (!roomState || !roomState.mines) return;
    roomState.mines.forEach(m => {
        const isArmed = Date.now() >= m.armedAt;
        const isTriggered = !!m.triggeredAt;

        // Draw Radius
        if (isArmed) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(m.x, m.y, 60, 0, Math.PI * 2);
            ctx.strokeStyle = isTriggered ? 'rgba(255, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.1)';
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.restore();
        }

        ctx.save();
        const pulse = Math.sin(time / (isTriggered ? 100 : 200)) * 5 + 10;
        ctx.beginPath();
        ctx.arc(m.x, m.y, pulse, 0, Math.PI * 2);
        ctx.fillStyle = isTriggered ? '#ff0' : m.color;
        ctx.shadowBlur = 15;
        ctx.shadowColor = isTriggered ? '#ff0' : m.color;
        ctx.fill();

        // White core
        ctx.beginPath();
        ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.restore();
    });
}

function drawGameOver() {
    if (!gameOverData) return;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#ff0';
    ctx.font = '60px Orbitron';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#ff0';
    ctx.fillText('MATCH OVER!', canvas.width / 2, canvas.height / 2 - 40);

    ctx.fillStyle = '#fff';
    ctx.font = '30px Orbitron';
    ctx.shadowColor = '#fff';
    let text = gameOverData.winner ? `${gameOverData.winner} WINS WITH ${gameOverData.maxScore} PTS!` : "IT'S A TIE!";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 20);
}


// ─── Game Loop ────────────────────────────────────────────────────────────────
function gameLoop(time) {
    const shakeX = (Math.random() - 0.5) * shakeIntensity;
    const shakeY = (Math.random() - 0.5) * shakeIntensity;
    shakeIntensity *= 0.9;
    if (shakeIntensity < 0.1) shakeIntensity = 0;

    ctx.save();
    ctx.translate(shakeX, shakeY);
    ctx.clearRect(-100, -100, canvas.width + 200, canvas.height + 200);

    drawStars();
    drawWalls();
    drawBoxes();
    drawDroppedPowerups(time);
    drawMines(time);

    // ── Draw Laser Beams ─────────────────────────────────────────────
    for (let i = laserBeams.length - 1; i >= 0; i--) {
        const b = laserBeams[i];
        b.life -= 0.05;
        if (b.life <= 0) { laserBeams.splice(i, 1); continue; }

        ctx.save();
        ctx.globalAlpha = b.life;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 8;
        ctx.shadowBlur = 20;
        ctx.shadowColor = b.color;

        ctx.beginPath();
        ctx.moveTo(b.startX, b.startY);
        ctx.lineTo(b.endX, b.endY);
        ctx.stroke();

        ctx.strokeStyle = b.color;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
    }

    // ── Interpolation alpha ──────────────────────────────────────────
    const elapsed = Date.now() - lastUpdateTime;
    const alpha = Math.min(elapsed / SERVER_TICK_MS, 1);

    // ── Draw interpolated bullets ────────────────────────────────────
    // Use target bullets directly (they move fast enough that lerp is not needed)
    roomState.bullets.forEach(b => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.type === 'laser' ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = b.color;
        ctx.fill();
        ctx.closePath();

        // Trail effect
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x - b.vx * (b.type === 'laser' ? 4 : 2), b.y - b.vy * (b.type === 'laser' ? 4 : 2));
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.type === 'laser' ? 6 : 3;
        ctx.stroke();
        ctx.closePath();
        ctx.restore();
    });

    // ── Draw Particles ───────────────────────────────────────────────
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;

        if (p.life <= 0) { particles.splice(i, 1); continue; }

        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.restore();
    }

    // ── Draw Floating Text ───────────────────────────────────────────
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
        const ft = floatingTexts[i];
        ft.y += ft.vy;
        ft.life -= 0.015;
        if (ft.life <= 0) { floatingTexts.splice(i, 1); continue; }

        ctx.save();
        ctx.globalAlpha = ft.life;
        ctx.fillStyle = ft.color;
        ctx.font = 'bold 16px Orbitron';
        ctx.textAlign = 'center';
        ctx.shadowBlur = 10;
        ctx.shadowColor = ft.color;
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.restore();
    }

    // Draw Parry effects
    for (let i = parries.length - 1; i >= 0; i--) {
        const p = parries[i];
        p.life -= 0.04;
        if (p.life <= 0) { parries.splice(i, 1); continue; }
        ctx.save();
        ctx.globalAlpha = p.life;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 4;
        ctx.shadowBlur = 20;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        // Expanding ring
        ctx.arc(p.x, p.y, 70 * (1 - p.life), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // Draw Slashes
    for (let i = slashes.length - 1; i >= 0; i--) {
        const s = slashes[i];
        s.life -= 0.04;
        if (s.life <= 0) { slashes.splice(i, 1); continue; }
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);
        ctx.globalAlpha = s.life;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4;
        ctx.shadowBlur = 30;
        ctx.shadowColor = '#00ffff';
        ctx.beginPath();
        // X shape slash
        ctx.moveTo(-40, -40); ctx.lineTo(40, 40);
        ctx.moveTo(40, -40); ctx.lineTo(-40, 40);
        ctx.stroke();
        ctx.restore();
    }

    // Draw interpolated Players ────────────────────────────────────
    for (const pid in targetState.players) {
        const tp = targetState.players[pid];
        const pp = prevState.players[pid];

        const rx = pp ? lerp(pp.x, tp.x, alpha) : tp.x;
        const ry = pp ? lerp(pp.y, tp.y, alpha) : tp.y;
        const ra = pp ? lerpAngle(pp.angle, tp.angle, alpha) : tp.angle;

        let drawAlpha = 1.0;
        if (tp.isInvisible) drawAlpha = (Math.floor(Date.now() / 80) % 2 === 0) ? 0.3 : 1.0; // Flashy flicker

        if (tp.isPilot) {
            drawAlpha *= 1.0; // Pilots are solid
            drawPilot(rx, ry, ra, tp.color, drawAlpha);
        } else {
            drawTriangle(rx, ry, ra, tp.color, tp.isHit, drawAlpha);
        }

        // Superdash Trail
        if (tp.isSuperDashing) {
            ctx.save();
            ctx.translate(rx, ry);
            ctx.rotate(ra);
            ctx.globalAlpha = 0.5;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#fff';
            ctx.beginPath();
            ctx.moveTo(-10, -15); ctx.lineTo(-40, 0); ctx.lineTo(-10, 15);
            ctx.stroke();
            ctx.restore();
        }

        if (tp.isPilot) {
            ctx.save();
            ctx.globalAlpha = 1.0;
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.font = 'bold 10px Orbitron';
            ctx.textAlign = 'center';
            ctx.fillText('PILOT', rx, ry + 30);
            ctx.restore();
        }

        // Purple Side Daggers with Durability Rendering
        if ((tp.hasLeftDagger || tp.hasRightDagger) && !tp.isPilot) {
            ctx.save();
            ctx.translate(rx, ry);
            ctx.rotate(ra);
            ctx.globalAlpha = drawAlpha;

            const daggerColor = '#ff00ff'; // Neon Pink
            ctx.strokeStyle = daggerColor;
            ctx.lineWidth = 5;
            ctx.shadowBlur = 25;
            ctx.shadowColor = daggerColor;

            if (tp.hasLeftDagger) {
                ctx.beginPath();
                ctx.moveTo(-5, -22); ctx.lineTo(20, -32); // Prominent Sharp Dagger
                ctx.stroke();
                // Inner glow
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(-3, -22); ctx.lineTo(15, -29);
                ctx.stroke();
                ctx.strokeStyle = daggerColor; ctx.lineWidth = 5; // Reset
            }

            if (tp.hasRightDagger) {
                ctx.beginPath();
                ctx.moveTo(-5, 22); ctx.lineTo(20, 32);
                ctx.stroke();
                // Inner glow
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(-3, 22); ctx.lineTo(15, 29);
                ctx.stroke();
            }

            ctx.restore();
        }

        if (!tp.isHit || tp.isPilot) {
            const indicatorColor = (tp.activePowerup && tp.activePowerup.type === 'laser') ? POWERUP_COLORS['laser'] : (tp.activePowerup ? POWERUP_COLORS[tp.activePowerup.type] : '#fff');
            drawBulletsIndicator(rx, ry, tp.bullets, time, indicatorColor);
        }

        // HP pips removed as requested
        // drawHpPips(rx, ry, tp.hp ?? 3, tp.maxHp ?? 3, tp.color);

        ctx.fillStyle = '#fff';
        ctx.font = '12px Orbitron';
        ctx.textAlign = 'center';
        ctx.shadowBlur = 0;
        ctx.fillText(tp.name, rx, ry - 45);
        if (pid === myId) {
            ctx.fillStyle = '#ff0';
            ctx.fillText('You', rx, ry + 50);
        }

        // DASH FIRE JET
        if (tp.dashFrames > 0) {
            for (let i = 0; i < 5; i++) {
                const colors = ['#ff4500', '#ff8c00', '#ffd700', '#ff0000'];
                const color = colors[Math.floor(Math.random() * colors.length)];
                const backAngle = ra + Math.PI + (Math.random() - 0.5) * 0.5;
                const speed = Math.random() * 8 + 4;
                particles.push({
                    x: rx - Math.cos(ra) * 15,
                    y: ry - Math.sin(ra) * 15,
                    vx: Math.cos(backAngle) * speed,
                    vy: Math.sin(backAngle) * speed,
                    life: 0.6 + Math.random() * 0.4,
                    color: color
                });
            }
        }
    }

    ctx.restore(); // End screen shake translate

    if (roomState.state === 'GAMEOVER') drawGameOver();

    updateHUD();
    requestAnimationFrame(gameLoop);
}

function resizeScaleWrap() {
    const wrap = document.getElementById('game-scale-wrap');
    if (!wrap) return;
    const scaleX = window.innerWidth / 1600;
    const scaleY = window.innerHeight / 1080;
    const scale = Math.min(scaleX, scaleY) * 0.98; // slight padding
    wrap.style.transform = `scale(${scale})`;
}
window.addEventListener('resize', resizeScaleWrap);
resizeScaleWrap();
