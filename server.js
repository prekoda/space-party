// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;

// Serve frontend files
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));
// Serve SPA frontend for all routes
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// -------------------- Game Constants --------------------
const CANVAS_WIDTH = 1600;
const CANVAS_HEIGHT = 1000;
const PLAYER_SPEED = 3.5;
const PLAYER_ROTATION_SPEED = 0.08;
const MAX_BULLETS = 3;
const BULLET_REFILL_RATE = parseInt(process.env.BULLET_REFILL_RATE) || 2000;
const BULLET_SPEED = 10;
const BULLET_LIFE = 100;
const HIT_FREEZE_TIME = 2000;
const MATCH_DURATION = parseInt(process.env.MATCH_DURATION) || 5 * 60 * 1000;
const BOX_RESPAWN_TIME = 15000;
const POWERUP_TYPES = ['laser', 'missiles', 'shield', 'scatter', 'mine', 'jouster', 'reverse', 'superdash'];

const WALLS = [
  { x: 0, y: 0, w: 1600, h: 20 }, { x: 0, y: 980, w: 1600, h: 20 },
  { x: 0, y: 0, w: 20, h: 1000 }, { x: 1580, y: 0, w: 20, h: 1000 },
  { x: 300, y: 250, w: 300, h: 40 }, { x: 1000, y: 250, w: 300, h: 40 },
  { x: 300, y: 710, w: 300, h: 40 }, { x: 1000, y: 710, w: 300, h: 40 },
  { x: 780, y: 450, w: 40, h: 100 }
];

// -------------------- Utility --------------------
function circleRectCollide(circle, rect) {
  let testX = circle.x, testY = circle.y;
  if (circle.x < rect.x) testX = rect.x; else if (circle.x > rect.x + rect.w) testX = rect.x + rect.w;
  if (circle.y < rect.y) testY = rect.y; else if (circle.y > rect.y + rect.h) testY = rect.y + rect.h;
  const distX = circle.x - testX, distY = circle.y - testY;
  const distance = Math.hypot(distX, distY);
  if (distance < circle.radius) {
    const depth = circle.radius - distance;
    if (distance === 0) return { hit: true, dx: depth, dy: 0 };
    return { hit: true, dx: (distX / distance) * depth, dy: (distY / distance) * depth };
  }
  return { hit: false };
}

function spawnBox(room) {
  let x, y, safe = false, attempts = 0;
  while (!safe && attempts < 100) {
    x = Math.random() * (CANVAS_WIDTH - 100) + 50;
    y = Math.random() * (CANVAS_HEIGHT - 100) + 50;
    safe = true;
    for (const w of WALLS) if (circleRectCollide({ x, y, radius: 25 }, w).hit) { safe = false; break; }
    attempts++;
  }
  room.boxes.push({
    id: Math.random().toString(36).substr(2, 9),
    x: x || 800, y: y || 500, hp: 1, size: 30
  });
}

function dropPowerup(room, x, y) {
  const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
  room.droppedPowerups.push({
    id: Math.random().toString(36).substr(2, 9),
    x, y, type, spawnTime: Date.now()
  });
}

// -------------------- Game State --------------------
const rooms = {};

function createRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId, players: {}, bullets: [], mines: [], state: 'PLAYING',
      matchEndTime: Date.now() + MATCH_DURATION,
      boxes: [], droppedPowerups: [], lastBoxSpawn: Date.now(),
      lastUpdate: Date.now()
    };
    for (let i = 0; i < 10; i++) spawnBox(rooms[roomId]);
  }
}

function spawnPlayer(room, socketId, name, color) {
  let x, y, safe = false, attempts = 0;
  while (!safe && attempts < 100) {
    x = Math.random() * (CANVAS_WIDTH - 100) + 50;
    y = Math.random() * (CANVAS_HEIGHT - 100) + 50;
    safe = true;
    for (const w of WALLS) if (circleRectCollide({ x, y, radius: 20 }, w).hit) { safe = false; break; }
    attempts++;
  }
  room.players[socketId] = {
    id: socketId, name, color, x: x || 600, y: y || 400, angle: Math.random() * Math.PI * 2,
    score: room.players[socketId] ? room.players[socketId].score : 0,
    bullets: MAX_BULLETS, lastRefill: Date.now(),
    activePowerup: null, // { type: 'laser'|'missiles'|..., ammo: number, endTime: number }
    isHit: false, hitTime: 0, inputs: { turn: false },
    dashFrames: 0, dashCooldownUntil: 0,
    hp: 3, maxHp: 3, lastHitTime: 0,
    reversed: false,
    isPilot: false, pilotUntil: 0,
    isInvisible: false, invisibilityUntil: 0,
    hasLeftDagger: false, hasRightDagger: false,
    jousterSpeedUntil: 0,
    recoilX: 0, recoilY: 0
  };
}

function joinRoom(socket, roomId, name, color) {
  socket.join(roomId);
  if (!rooms[roomId]) createRoom(roomId);
  spawnPlayer(rooms[roomId], socket.id, name, color);
  socket.roomId = roomId;
  io.to(roomId).emit('playerJoined', { players: rooms[roomId].players });
}

// -------------------- Socket.IO --------------------
io.on('connection', socket => {
  console.log("Player connected:", socket.id);

  socket.on('joinRoom', ({ roomId, name, color }) => {
    joinRoom(socket, roomId, name, color);
  });

  socket.on('input', inputs => {
    const room = rooms[socket.roomId];
    if (room && room.players[socket.id] && room.state === 'PLAYING')
      room.players[socket.id].inputs = inputs;
  });

  socket.on('dash', () => {
    const room = rooms[socket.roomId];
    if (!room || room.state !== 'PLAYING') return;
    const player = room.players[socket.id];
    if (!player) return;

    if (player.isPilot) {
      // Pilot PARRY (Forward Arc)
      const now = Date.now();
      if (now < player.dashCooldownUntil) return;
      player.dashCooldownUntil = now + 800;

      // Destroy nearby normal bullets in front
      for (let i = room.bullets.length - 1; i >= 0; i--) {
        const b = room.bullets[i];
        const dist = Math.hypot(b.x - player.x, b.y - player.y);
        const angleToBullet = Math.atan2(b.y - player.y, b.x - player.x);
        let diff = angleToBullet - player.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        if (b.type === 'normal' && dist < 65 && Math.abs(diff) < Math.PI / 2) {
          room.bullets.splice(i, 1);
        }
      }
      io.to(socket.roomId).emit('parry', { x: player.x, y: player.y, color: player.color });
      return;
    }

    if (player.isHit && !player.isPilot) return;
    const now = Date.now();
    if (now < player.dashCooldownUntil) return; // still on cooldown

    if (player.activePowerup && player.activePowerup.type === 'superdash') {
      player.dashFrames = 15;
      player.isSuperDashing = true;
      player.activePowerup.ammo--;
      if (player.activePowerup.ammo <= 0) player.activePowerup = null;
      player.dashCooldownUntil = now + 1000; // shorter cooldown for superdash
    } else {
      player.dashFrames = 8;          // ~130 ms of boost at 60 Hz
      player.isSuperDashing = false;
      player.dashCooldownUntil = now + 1500; // 1.5 s cooldown
    }
  });

  socket.on('shoot', () => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room || room.state !== 'PLAYING') return;
    const player = room.players[socket.id];
    if (!player || player.isHit || player.isPilot) return;

    if (!player.activePowerup && player.bullets <= 0) return;
    // Default normal shot
    const baseBullet = {
      id: Math.random().toString(36).substr(2, 9), ownerId: socket.id,
      x: player.x, y: player.y,
      vx: 0, vy: 0,
      type: 'normal', life: BULLET_LIFE,
      angle: player.angle, color: player.color
    };

    if (player.activePowerup) {
      const pType = player.activePowerup.type;

      if (pType === 'laser') {
        player.activePowerup.ammo--;

        let cx = player.x + Math.cos(player.angle) * 20;
        let cy = player.y + Math.sin(player.angle) * 20;
        const step = 5;
        let dist = 0;
        const hitPlayers = new Set();
        const hitBoxes = new Set();

        while (dist < 2000) {
          cx += Math.cos(player.angle) * step;
          cy += Math.sin(player.angle) * step;
          dist += step;

          for (const pid in room.players) {
            if (pid === socket.id) continue;
            const p = room.players[pid];
            if (!p.isHit && !hitPlayers.has(pid) && Math.hypot(p.x - cx, p.y - cy) < 20) {
              hitPlayers.add(pid);
              p.hp -= 3;
              p.lastHitTime = Date.now();
              player.score++;
              io.to(roomId).emit('hit', { x: p.x, y: p.y, targetId: pid });
              if (p.hp <= 0) {
                p.isHit = true; p.hitTime = Date.now();
                p.hasLeftDagger = false; p.hasRightDagger = false; p.activePowerup = null;
              }
            }
          }

          for (let k = room.boxes.length - 1; k >= 0; k--) {
            const box = room.boxes[k];
            if (!hitBoxes.has(box.id) && Math.hypot(box.x - cx, box.y - cy) < 25) {
              hitBoxes.add(box.id);
              dropPowerup(room, box.x, box.y);
              room.boxes.splice(k, 1);
              io.to(roomId).emit('boxBroken', { x: box.x, y: box.y });
            }
          }
        }

        io.to(roomId).emit('laserFired', {
          startX: player.x + Math.cos(player.angle) * 20,
          startY: player.y + Math.sin(player.angle) * 20,
          endX: cx, endY: cy,
          color: player.color
        });

        // RECOIL
        player.recoilX -= Math.cos(player.angle) * 8;
        player.recoilY -= Math.sin(player.angle) * 8;
      }
      else if (pType === 'scatter') {
        for (let i = 0; i < 8; i++) {
          const b = { ...baseBullet };
          const ang = player.angle + (i * Math.PI / 4);
          b.x += Math.cos(ang) * 20;
          b.y += Math.sin(ang) * 20;
          b.vx = Math.cos(ang) * BULLET_SPEED;
          b.vy = Math.sin(ang) * BULLET_SPEED;
          room.bullets.push(b);
        }
        player.activePowerup.ammo--;
      }
      else if (pType === 'missiles') {
        // Fire 2 missiles angled slightly
        for (let i = -1; i <= 1; i += 2) {
          const b = { ...baseBullet };
          b.type = 'missile';
          b.life = 200;
          const ang = player.angle + (i * 0.3);
          b.x += Math.cos(ang) * 20;
          b.y += Math.sin(ang) * 20;
          b.vx = Math.cos(ang) * BULLET_SPEED * 0.5; // Starts slow
          b.vy = Math.sin(ang) * BULLET_SPEED * 0.5;
          b.angle = ang;
          room.bullets.push(b);
        }
        player.activePowerup.ammo--;

        // RECOIL
        player.recoilX -= Math.cos(player.angle) * 5;
        player.recoilY -= Math.sin(player.angle) * 5;
      }
      else if (pType === 'mine') {
        room.mines.push({
          id: Math.random().toString(36).substr(2, 9),
          ownerId: socket.id,
          x: player.x, y: player.y,
          color: player.color,
          armedAt: Date.now() + 1000 // 1s arm time
        });
        player.activePowerup.ammo--;
      }
      else if (pType === 'jouster') {
        // Jouster doesn't shoot normally, but we shouldn't drain ammo on spacebar
        // It's a duration-based effect handled in the loop.
        // We do nothing here, let the normal bullet fire as fallback, or block it.
        // Let's block normal firing while jousting for balance.
      }

      if (player.activePowerup && player.activePowerup.ammo <= 0) {
        player.activePowerup = null;
      }

    } else {
      // Normal bullet
      player.bullets--;
      const b = { ...baseBullet };
      b.x += Math.cos(player.angle) * 20;
      b.y += Math.sin(player.angle) * 20;
      b.vx = Math.cos(player.angle) * BULLET_SPEED;
      b.vy = Math.sin(player.angle) * BULLET_SPEED;
      room.bullets.push(b);
    }

  });

  socket.on('disconnect', () => {
    if (socket.roomId && rooms[socket.roomId]) {
      delete rooms[socket.roomId].players[socket.id];
      io.to(socket.roomId).emit('playerLeft', socket.id);
      if (Object.keys(rooms[socket.roomId].players).length === 0) delete rooms[socket.roomId];
    }
  });
});

// -------------------- Game Loop --------------------
const TICK_RATE = 1000 / 60;
setInterval(() => {
  const now = Date.now();
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.state === 'PLAYING') {
      // match end
      if (now >= room.matchEndTime) {
        room.state = 'GAMEOVER';
        room.restartAt = now + 5000;
        let winner = null, maxScore = -1;
        for (const pid in room.players) {
          if (room.players[pid].score > maxScore) { maxScore = room.players[pid].score; winner = room.players[pid].name; }
        }
        io.to(roomId).emit('gameOver', { winner, maxScore });
        continue;
      }

      // process expired powerups
      for (const pid in room.players) {
        const p = room.players[pid];
        if (p.activePowerup && p.activePowerup.endTime < now) {
          p.activePowerup = null;
        }
      }
      if (room.boxes.length < 4 && now - room.lastBoxSpawn > BOX_RESPAWN_TIME) {
        spawnBox(room);
        room.lastBoxSpawn = now;
      }

      // clear old dropped powerups (expire after 15s)
      room.droppedPowerups = room.droppedPowerups.filter(dp => now - dp.spawnTime < 15000);

      // update players
      for (const pid in room.players) {
        const p = room.players[pid];

        // Handle Pilot & Invis timers
        if (p.isPilot && now > p.pilotUntil) {
          p.isPilot = false;
          p.hp = 3;
          p.maxHp = 3;
          p.isHit = false;
          p.isInvisible = true;
          p.invisibilityUntil = now + 2000;
          io.to(roomId).emit('respawnFlash', { x: p.x, y: p.y, color: p.color });
        }
        if (p.isInvisible && now > p.invisibilityUntil) {
          p.isInvisible = false;
        }

        // refill bullets
        if (p.bullets < MAX_BULLETS && now - p.lastRefill > BULLET_REFILL_RATE) { p.bullets++; p.lastRefill = now; }

        if (p.isHit && !p.isPilot && now - p.hitTime > HIT_FREEZE_TIME) {
          p.isPilot = true;
          p.pilotUntil = now + 4000;
        }

        if (!p.isHit || p.isPilot) {
          if (p.inputs.turn) {
            p.angle += p.reversed ? -PLAYER_ROTATION_SPEED : PLAYER_ROTATION_SPEED;
          }
          let speed = p.dashFrames > 0 ? (p.isSuperDashing ? PLAYER_SPEED * 6 : PLAYER_SPEED * 3) : PLAYER_SPEED;
          if (p.isPilot) speed = PLAYER_SPEED * 0.8; // Pilot moves slower
          if (now < p.jousterSpeedUntil) speed *= 1.3; // Temporary Jouster Speed Boost

          if (p.dashFrames > 0) {
            p.dashFrames--;
            if (p.dashFrames === 0) p.isSuperDashing = false;
          }

          let moveX = Math.cos(p.angle) * speed + p.recoilX;
          let moveY = Math.sin(p.angle) * speed + p.recoilY;

          p.x += moveX;
          p.y += moveY;

          p.recoilX *= 0.9;
          p.recoilY *= 0.9;
          for (const w of WALLS) {
            const res = circleRectCollide({ x: p.x, y: p.y, radius: p.isPilot ? 10 : 15 }, w);
            if (res.hit) { p.x += res.dx; p.y += res.dy; }
          }

          // Check box collision (dash breaks them)
          for (let i = room.boxes.length - 1; i >= 0; i--) {
            const box = room.boxes[i];
            const dist = Math.hypot(p.x - box.x, p.y - box.y);
            if (dist < (p.isPilot ? 10 : 15) + box.size / 2) {
              if (p.dashFrames > 0 && !p.isPilot) {
                // Instantly break box
                dropPowerup(room, box.x, box.y);
                room.boxes.splice(i, 1);
                io.to(roomId).emit('boxBroken', { x: box.x, y: box.y });
                if (p.isSuperDashing) {
                  io.to(roomId).emit('superDashKill', { x: box.x, y: box.y, targetType: 'box' });
                }
              } else {
                // Push player away slightly like a circular wall
                const overlap = ((p.isPilot ? 10 : 15) + box.size / 2) - dist;
                p.x += (p.x - box.x) / dist * overlap;
                p.y += (p.y - box.y) / dist * overlap;
              }
            }
          }

          // Check superdash player kill
          if (p.isSuperDashing) {
            for (const otherId in room.players) {
              if (otherId === pid) continue;
              const op = room.players[otherId];
              if (op.isHit || op.isPilot || op.isInvisible) continue;
              if (Math.hypot(p.x - op.x, p.y - op.y) < 30) {
                op.hp = 0;
                op.isHit = true; op.hitTime = now;
                op.hasLeftDagger = false; op.hasRightDagger = false; op.activePowerup = null;
                p.score += 5;
                io.to(roomId).emit('superDashKill', { x: op.x, y: op.y, targetId: otherId, targetType: 'player' });
              }
            }
          }

          // Persistent Side Daggers (Jouster) with Durability
          if ((p.hasLeftDagger || p.hasRightDagger) && !p.isPilot) {
            const sideOffset = 22;
            const daggers = [];
            if (p.hasLeftDagger) daggers.push({ type: 'left', x: p.x + Math.cos(p.angle - Math.PI / 2) * sideOffset, y: p.y + Math.sin(p.angle - Math.PI / 2) * sideOffset });
            if (p.hasRightDagger) daggers.push({ type: 'right', x: p.x + Math.cos(p.angle + Math.PI / 2) * sideOffset, y: p.y + Math.sin(p.angle + Math.PI / 2) * sideOffset });

            for (const d of daggers) {
              let broken = false;
              // Hit players
              for (const otherId in room.players) {
                if (otherId === pid) continue;
                const op = room.players[otherId];
                if (op.isHit || op.isInvisible) continue;
                const invinc = (now - op.lastHitTime < 500);
                if (!invinc && Math.hypot(op.x - d.x, op.y - d.y) < 20) {
                  op.hp -= 3; op.lastHitTime = now;
                  p.score++;
                  io.to(roomId).emit('hit', { x: op.x, y: op.y, targetId: otherId });
                  if (op.hp <= 0) {
                    op.isHit = true; op.hitTime = now;
                    op.hasLeftDagger = false; op.hasRightDagger = false; op.activePowerup = null;
                  }
                  broken = true;
                  break;
                }
              }
              if (broken) {
                if (d.type === 'left') p.hasLeftDagger = false; else p.hasRightDagger = false;
                continue;
              }

              // Hit boxes
              for (let k = room.boxes.length - 1; k >= 0; k--) {
                const box = room.boxes[k];
                if (Math.hypot(box.x - d.x, box.y - d.y) < 30) {
                  dropPowerup(room, box.x, box.y);
                  room.boxes.splice(k, 1);
                  io.to(roomId).emit('boxBroken', { x: box.x, y: box.y });
                  broken = true;
                  break;
                }
              }
              if (broken) {
                if (d.type === 'left') p.hasLeftDagger = false; else p.hasRightDagger = false;
                continue;
              }
            }
          }
        }

        // Check dropped powerup pickup
        for (let i = room.droppedPowerups.length - 1; i >= 0; i--) {
          const dp = room.droppedPowerups[i];
          if (Math.hypot(p.x - dp.x, p.y - dp.y) < 25) {
            if (dp.type === 'shield') {
              p.hp = p.maxHp;
              p.score += 1;
              io.to(roomId).emit('shieldGained', { pid });
            } else if (dp.type === 'reverse') {
              p.reversed = !p.reversed;
              p.score += 1;
            } else if (dp.type === 'jouster') {
              p.hasLeftDagger = true;
              p.hasRightDagger = true;
              p.jousterSpeedUntil = now + 10000;
              p.score += 2;
              io.to(roomId).emit('powerupCollected', { x: dp.x, y: dp.y, type: dp.type, pid });
            } else {
              let ammo = 1, duration = 30000;
              p.activePowerup = { type: dp.type, ammo, endTime: now + duration };
              p.score += 2;
              io.to(roomId).emit('powerupCollected', { x: dp.x, y: dp.y, type: dp.type, pid });
            }
            room.droppedPowerups.splice(i, 1);
          }
        }
      }

      // update bullets
      for (let i = room.bullets.length - 1; i >= 0; i--) {
        const b = room.bullets[i];

        // Homing logic for missiles
        if (b.type === 'missile') {
          let closestPlayer = null, minDist = 400; // Agro range
          for (const pid in room.players) {
            if (pid === b.ownerId) continue;
            const p = room.players[pid];
            if (p.isHit || p.isPilot) continue;
            const dist = Math.hypot(p.x - b.x, p.y - b.y);
            if (dist < minDist) { minDist = dist; closestPlayer = p; }
          }
          if (closestPlayer) {
            const targetAngle = Math.atan2(closestPlayer.y - b.y, closestPlayer.x - b.x);
            let diff = targetAngle - b.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            b.angle += Math.sign(diff) * 0.05;
          }
          b.vx = Math.cos(b.angle) * BULLET_SPEED;
          b.vy = Math.sin(b.angle) * BULLET_SPEED;
        }

        b.x += b.vx; b.y += b.vy; b.life--;
        let destroyed = false;
        for (const w of WALLS) if (b.x > w.x && b.x < w.x + w.w && b.y > w.y && b.y < w.y + w.h) { destroyed = true; break; }

        if (!destroyed) {
          for (let k = room.boxes.length - 1; k >= 0; k--) {
            const box = room.boxes[k];
            if (b.x > box.x - box.size / 2 && b.x < box.x + box.size / 2 &&
              b.y > box.y - box.size / 2 && b.y < box.y + box.size / 2) {
              destroyed = true;
              dropPowerup(room, box.x, box.y);
              room.boxes.splice(k, 1);
              io.to(roomId).emit('boxBroken', { x: box.x, y: box.y });
              break;
            }
          }
        }
        for (const pid in room.players) {
          if (destroyed) break;
          if (pid !== b.ownerId) {
            const p = room.players[pid];
            const invincible = p.isHit || (now - p.lastHitTime < 500) || p.isInvisible;
            if (!invincible && Math.hypot(p.x - b.x, p.y - b.y) < 20) {
              destroyed = true;
              if (b.type !== 'missile') {
                const damage = (b.type === 'laser') ? 3 : 1;
                p.hp -= damage; p.lastHitTime = now;
                if (room.players[b.ownerId]) room.players[b.ownerId].score++;
                io.to(roomId).emit('hit', { x: p.x, y: p.y, targetId: pid });
                if (p.hp <= 0) {
                  p.isHit = true; p.hitTime = now;
                  p.hasLeftDagger = false; p.hasRightDagger = false; p.activePowerup = null;
                }
              }
            }
          }
        }
        if (!destroyed) {
          for (let k = room.mines.length - 1; k >= 0; k--) {
            const mine = room.mines[k];
            if (Math.hypot(b.x - mine.x, b.y - mine.y) < 20) {
              mine.detonateNow = true;
              destroyed = true;
              break;
            }
          }
        }

        // Blocking: Check for bullet collision with daggers
        for (const pid in room.players) {
          const p = room.players[pid];
          if (p.isHit || p.isPilot || (!p.hasLeftDagger && !p.hasRightDagger)) continue;
          if (pid === b.ownerId) continue;
          const sideOffset = 22;
          if (p.hasLeftDagger) {
            const dx = p.x + Math.cos(p.angle - Math.PI / 2) * sideOffset;
            const dy = p.y + Math.sin(p.angle - Math.PI / 2) * sideOffset;
            if (Math.hypot(b.x - dx, b.y - dy) < 25) { destroyed = true; p.hasLeftDagger = false; break; }
          }
          if (p.hasRightDagger) {
            const dx = p.x + Math.cos(p.angle + Math.PI / 2) * sideOffset;
            const dy = p.y + Math.sin(p.angle + Math.PI / 2) * sideOffset;
            if (Math.hypot(b.x - dx, b.y - dy) < 25) { destroyed = true; p.hasRightDagger = false; break; }
          }
        }

        if (destroyed && b.type === 'missile') {
          io.to(roomId).emit('missileExploded', { x: b.x, y: b.y });
          for (const spid in room.players) {
            const sp = room.players[spid];
            if (!sp.isHit && Math.hypot(sp.x - b.x, sp.y - b.y) < 80) {
              sp.hp -= 3; sp.lastHitTime = now;
              if (room.players[b.ownerId] && spid !== b.ownerId) room.players[b.ownerId].score++;
              io.to(roomId).emit('hit', { x: sp.x, y: sp.y, targetId: spid });
              if (sp.hp <= 0) {
                sp.isHit = true; sp.hitTime = now;
                sp.hasLeftDagger = false; sp.hasRightDagger = false; sp.activePowerup = null;
              }
            }
          }
          for (let k = room.boxes.length - 1; k >= 0; k--) {
            const box = room.boxes[k];
            if (Math.hypot(box.x - b.x, box.y - b.y) < 80) {
              dropPowerup(room, box.x, box.y);
              room.boxes.splice(k, 1);
              io.to(roomId).emit('boxBroken', { x: box.x, y: box.y });
            }
          }
        }
        if (b.life <= 0 || destroyed) room.bullets.splice(i, 1);
      }

      // Update Mines
      for (let i = room.mines.length - 1; i >= 0; i--) {
        const m = room.mines[i];
        if (now < m.armedAt) continue;

        let inRange = false;
        for (const pid in room.players) {
          const p = room.players[pid];
          if (p.isHit || p.isPilot || p.isInvisible) continue;
          if (Math.hypot(p.x - m.x, p.y - m.y) < 60) {
            inRange = true;
            break;
          }
        }

        if (inRange && !m.triggeredAt) {
          m.triggeredAt = now;
          io.to(roomId).emit('mineTriggered', { id: m.id });
        }

        const shouldExplode = m.detonateNow || (m.triggeredAt && now - m.triggeredAt > 1500);

        if (shouldExplode) {
          io.to(roomId).emit('mineExploded', { x: m.x, y: m.y });
          for (const pid in room.players) {
            const p = room.players[pid];
            if (!p.isHit && !p.isInvisible && Math.hypot(p.x - m.x, p.y - m.y) < 80) {
              const dist = Math.hypot(p.x - m.x, p.y - m.y);
              let blocked = false;
              if (p.hasLeftDagger || p.hasRightDagger) {
                // Block the explosion damage and lose one dagger
                if (p.hasLeftDagger) p.hasLeftDagger = false;
                else p.hasRightDagger = false;
                blocked = true;
              }

              if (!blocked) {
                p.hp -= 3; p.lastHitTime = now;
                if (room.players[m.ownerId] && m.ownerId !== pid) room.players[m.ownerId].score++;
                io.to(roomId).emit('hit', { x: p.x, y: p.y, targetId: pid });
                if (p.hp <= 0) {
                  p.isHit = true; p.hitTime = now;
                  p.hasLeftDagger = false; p.hasRightDagger = false; p.activePowerup = null;
                }
              }
            }
          }
          for (let k = room.boxes.length - 1; k >= 0; k--) {
            const box = room.boxes[k];
            if (Math.hypot(box.x - m.x, box.y - m.y) < 80) {
              dropPowerup(room, box.x, box.y);
              room.boxes.splice(k, 1);
              io.to(roomId).emit('boxBroken', { x: box.x, y: box.y });
            }
          }
          for (let k = room.mines.length - 1; k >= 0; k--) {
            if (k === i) continue;
            const om = room.mines[k];
            if (Math.hypot(om.x - m.x, om.y - m.y) < 80) {
              om.detonateNow = true;
            }
          }
          room.mines.splice(i, 1);
        }
      }
    } else if (room.state === 'GAMEOVER' && now >= room.restartAt) {
      room.state = 'PLAYING';
      room.matchEndTime = now + MATCH_DURATION;
      room.boxes = []; room.droppedPowerups = []; room.lastBoxSpawn = now;
      room.bullets = []; room.mines = [];
      for (let i = 0; i < 10; i++) spawnBox(room);
      for (const pid in room.players) { room.players[pid].score = 0; spawnPlayer(room, pid, room.players[pid].name, room.players[pid].color); }
    }

    io.to(roomId).emit('update', {
      players: room.players,
      bullets: room.bullets,
      state: room.state,
      timeRemaining: Math.max(0, room.matchEndTime - now),
      boxes: room.boxes,
      droppedPowerups: room.droppedPowerups,
      mines: room.mines,
      walls: WALLS
    });
  }
}, TICK_RATE);

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
