// The Room holds all authoritative game state for a single match and is the
// only place game rules live. One Room for this demo.

import {
  DT, KILLER_RADIUS, SURVIVOR_RADIUS, KILLER_SPEED, SURVIVOR_SPEED,
  SURVIVOR_HP, ATTACK_RANGE, ATTACK_ARC, ATTACK_COOLDOWN, HIT_INVULN, KNOCKBACK,
  LUNGE_SPEED, LUNGE_DURATION, LUNGE_COOLDOWN,
  SPRINT_MULTIPLIER, SPRINT_DURATION, SPRINT_COOLDOWN,
  OBJECTIVE_RADIUS, OBJECTIVE_TIME, OBJECTIVE_MAX_RATE,
  MIN_PLAYERS_TO_START,
} from './constants.js';
import { buildMap, pickSpawns, sampleObjectives } from './map.js';

const PHASE = { LOBBY: 'lobby', PLAYING: 'playing', OVER: 'over' };

function solid(grid, px, py, tile) {
  const tx = Math.floor(px / tile);
  const ty = Math.floor(py / tile);
  if (ty < 0 || ty >= grid.length || tx < 0 || tx >= grid[0].length) return true;
  return grid[ty][tx] === '#';
}

// A circle of radius r fits at (x,y) if none of its four corners hit a wall.
function fits(grid, x, y, r, tile = 32) {
  return (
    !solid(grid, x - r, y - r, tile) && !solid(grid, x + r, y - r, tile) &&
    !solid(grid, x - r, y + r, tile) && !solid(grid, x + r, y + r, tile)
  );
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function emptyInput() {
  return { up: false, down: false, left: false, right: false, action: false, attack: false, lunge: false, aim: 0 };
}

export class Room {
  constructor() {
    this.players = new Map();
    this.phase = PHASE.LOBBY;
    this.map = null;
    this.objectives = [];
    this.winner = null;
    this.elapsed = 0;
  }

  // ---- connection lifecycle ----

  addPlayer(id, name, ws) {
    if (this.players.has(id)) return;
    const isFirst = this.players.size === 0;
    this.players.set(id, {
      id, name, ws,
      host: isFirst,
      role: null,
      x: 0, y: 0,
      hp: SURVIVOR_HP,
      alive: true,
      input: emptyInput(),
      prevLunge: false,
      lastAttackAt: -999,
      lastLungeAt: -999,
      lungeUntil: 0,
      lungeDirX: 0, lungeDirY: 0,
      lungeHitDone: false,
      invulnUntil: 0,
      swing: false,
      lastAim: Math.PI / 2,  // default facing down
      sprintState: 'ready',  // 'ready' | 'active' | 'cooldown'
      sprintUntil: 0,
      sprintCooldownUntil: 0,
    });
    if (this.phase === PHASE.PLAYING) this.sendTo(id, { t: 'wait' });
    this.broadcastLobby();
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    const wasHost = p.host;
    const wasPlaying = this.phase === PHASE.PLAYING && p.role !== null;
    this.players.delete(id);
    if (wasHost) {
      const next = this.players.values().next().value;
      if (next) next.host = true;
    }
    if (wasPlaying) this.checkWin();
    if (this.phase === PHASE.PLAYING) this.broadcastState();
    else this.broadcastLobby();
  }

  // ---- input ----

  setInput(id, msg) {
    const p = this.players.get(id);
    if (!p || p.role === null || this.phase !== PHASE.PLAYING) return;
    p.input = {
      up: !!msg.up, down: !!msg.down, left: !!msg.left, right: !!msg.right,
      action: !!msg.action, attack: !!msg.attack, lunge: !!msg.lunge,
      aim: typeof msg.aim === 'number' ? msg.aim : p.input.aim,
    };
  }

  // ---- round control ----

  start(id) {
    const p = this.players.get(id);
    if (!p || !p.host) return;
    if (this.phase === PHASE.PLAYING) return;
    if (this.players.size < MIN_PLAYERS_TO_START) return;

    this.map = buildMap();
    this.winner = null;
    this.elapsed = 0;

    const spawns = pickSpawns(this.map);
    const ids = [...this.players.keys()];

    // Survivors cluster around one anchor; killer takes the far anchor.
    const ring = [
      [0, 0], [34, 0], [-34, 0], [0, 34], [0, -34],
      [34, 34], [-34, -34], [34, -34], [-34, 34],
    ];
    let ringIndex = 0;

    for (const pid of ids) {
      const pl = this.players.get(pid);
      pl.hp = SURVIVOR_HP;
      pl.alive = true;
      pl.input = emptyInput();
      pl.prevLunge = false;
      pl.lastAttackAt = -999;
      pl.lastLungeAt = -999;
      pl.lungeUntil = 0;
      pl.lungeHitDone = false;
      pl.invulnUntil = 0;
      pl.swing = false;
      pl.sprintState = 'ready';
      pl.sprintUntil = 0;
      pl.sprintCooldownUntil = 0;

      if (pid === id) {
        pl.role = 'killer';
        pl.x = spawns.killerAnchor.x;
        pl.y = spawns.killerAnchor.y;
      } else {
        pl.role = 'survivor';
        // find a free spot in the cluster ring
        let placed = false;
        while (ringIndex < ring.length && !placed) {
          const [ox, oy] = ring[ringIndex++];
          const sx = spawns.survivorAnchor.x + ox;
          const sy = spawns.survivorAnchor.y + oy;
          if (fits(this.map.grid, sx, sy, SURVIVOR_RADIUS)) {
            pl.x = sx; pl.y = sy; placed = true;
          }
        }
        if (!placed) { pl.x = spawns.survivorAnchor.x; pl.y = spawns.survivorAnchor.y; }
      }
    }

    // One generator per player in the match. Survivors must finish all of them.
    const genCount = this.players.size;
    const spots = sampleObjectives(this.map, genCount);
    this.objectives = spots.map(s => ({ x: s.x, y: s.y, progress: 0, done: false }));
    this.phase = PHASE.PLAYING;

    const config = {
      killerRadius: KILLER_RADIUS,
      survivorRadius: SURVIVOR_RADIUS,
      killerSpeed: KILLER_SPEED,
      survivorSpeed: SURVIVOR_SPEED,
      survivorHp: SURVIVOR_HP,
      lungeSpeed: LUNGE_SPEED,
      lungeDuration: LUNGE_DURATION,
      lungeCooldown: LUNGE_COOLDOWN,
      attackCooldown: ATTACK_COOLDOWN,
      attackRange: ATTACK_RANGE,
      sprintMultiplier: SPRINT_MULTIPLIER,
      sprintDuration: SPRINT_DURATION,
      sprintCooldown: SPRINT_COOLDOWN,
      objectiveRadius: OBJECTIVE_RADIUS,
      objectiveTime: OBJECTIVE_TIME,
      objectivesToWin: this.objectives.length,
    };
    const roster = ids.map(pid => {
      const pl = this.players.get(pid);
      return { id: pl.id, name: pl.name, role: pl.role };
    });
    for (const pid of ids) {
      const pl = this.players.get(pid);
      this.sendTo(pid, {
        t: 'init', you: pid, role: pl.role, config,
        map: { cols: this.map.cols, rows: this.map.rows, tiles: this.map.tiles },
        objectives: this.objectives.map(o => ({ x: o.x, y: o.y })),
        players: roster,
      });
    }
    this.broadcastState();
  }

  // ---- simulation ----

  update() {
    if (this.phase !== PHASE.PLAYING) return;
    this.elapsed += DT;

    const killer = [...this.players.values()].find(p => p.role === 'killer');
    if (killer) this.handleKillerActions(killer);

    for (const p of this.players.values()) {
      if (p.role !== null) this.tickSprint(p);
    }

    for (const p of this.players.values()) {
      if (p.role === null) continue;
      if (p.role === 'killer') this.moveKiller(p);
      else this.moveSurvivor(p);
    }

    this.resolveObjectives();
    this.checkWin();

    if (this.phase === PHASE.PLAYING) {
      this.broadcastState();
      for (const p of this.players.values()) p.swing = false;
    }
  }

  handleKillerActions(k) {
    // Swing: auto-repeats while held, gated by cooldown.
    if (k.input.attack && this.elapsed - k.lastAttackAt >= ATTACK_COOLDOWN && this.elapsed >= k.lungeUntil) {
      this.swing(k);
    }
    // Lunge: edge triggered, longer cooldown.
    const lungeEdge = k.input.lunge && !k.prevLunge;
    if (lungeEdge && this.elapsed - k.lastLungeAt >= LUNGE_COOLDOWN && this.elapsed >= k.lungeUntil) {
      k.lungeDirX = Math.cos(k.input.aim);
      k.lungeDirY = Math.sin(k.input.aim);
      k.lungeUntil = this.elapsed + LUNGE_DURATION;
      k.lastLungeAt = this.elapsed;
      k.lungeHitDone = false;
    }
    k.prevLunge = k.input.lunge;
  }

  swing(k) {
    k.lastAttackAt = this.elapsed;
    k.swing = true;
    for (const s of this.players.values()) {
      if (s.role !== 'survivor' || !s.alive || this.elapsed < s.invulnUntil) continue;
      const dx = s.x - k.x, dy = s.y - k.y;
      const dist = Math.hypot(dx, dy);
      if (dist > ATTACK_RANGE + SURVIVOR_RADIUS) continue;
      if (Math.abs(angleDiff(Math.atan2(dy, dx), k.input.aim)) <= ATTACK_ARC) {
        this.hit(s, dx, dy, dist);
      }
    }
  }

  hit(s, dx, dy, dist) {
    s.hp -= 1;
    s.invulnUntil = this.elapsed + HIT_INVULN;
    const len = dist || 1;
    this.knockback(s, dx / len, dy / len);
    if (s.hp <= 0) { s.hp = 0; s.alive = false; }
  }

  knockback(s, nx, ny) {
    const grid = this.map.grid;
    let moved = 0;
    const step = 4;
    while (moved < KNOCKBACK) {
      const tx = s.x + nx * step;
      const ty = s.y + ny * step;
      if (fits(grid, tx, s.y, SURVIVOR_RADIUS)) s.x = tx;
      if (fits(grid, s.x, ty, SURVIVOR_RADIUS)) s.y = ty;
      moved += step;
    }
  }

  moveKiller(k) {
    const grid = this.map.grid;
    if (this.elapsed < k.lungeUntil) {
      const nx = k.x + k.lungeDirX * LUNGE_SPEED * DT;
      if (fits(grid, nx, k.y, KILLER_RADIUS)) k.x = nx; else k.lungeUntil = 0;
      const ny = k.y + k.lungeDirY * LUNGE_SPEED * DT;
      if (fits(grid, k.x, ny, KILLER_RADIUS)) k.y = ny; else k.lungeUntil = 0;
      if (!k.lungeHitDone) {
        for (const s of this.players.values()) {
          if (s.role !== 'survivor' || !s.alive || this.elapsed < s.invulnUntil) continue;
          const dx = s.x - k.x, dy = s.y - k.y;
          const dist = Math.hypot(dx, dy);
          if (dist <= KILLER_RADIUS + SURVIVOR_RADIUS + 2) {
            this.hit(s, dx, dy, dist);
            k.lungeHitDone = true;
            k.lungeUntil = 0;
            break;
          }
        }
      }
      return;
    }
    this.applyInputMove(k, KILLER_SPEED, KILLER_RADIUS);
  }

  moveSurvivor(s) {
    if (!s.alive) return;
    this.applyInputMove(s, SURVIVOR_SPEED, SURVIVOR_RADIUS);
  }

  tickSprint(p) {
    if (p.sprintState === 'active' && this.elapsed >= p.sprintUntil) {
      p.sprintState = 'cooldown';
      p.sprintCooldownUntil = this.elapsed + SPRINT_COOLDOWN;
    } else if (p.sprintState === 'cooldown' && this.elapsed >= p.sprintCooldownUntil) {
      p.sprintState = 'ready';
    }
    // Start sprint on key press if ready (not while lunging).
    const notLunging = p.role !== 'killer' || this.elapsed >= p.lungeUntil;
    if (p.input.sprint && p.sprintState === 'ready' && notLunging) {
      p.sprintState = 'active';
      p.sprintUntil = this.elapsed + SPRINT_DURATION;
    }
    // Release key early -> end sprint and start cooldown.
    if (!p.input.sprint && p.sprintState === 'active') {
      p.sprintState = 'cooldown';
      p.sprintCooldownUntil = this.elapsed + SPRINT_COOLDOWN;
    }
  }

  applyInputMove(p, speed, radius) {
    const grid = this.map.grid;
    let dx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
    let dy = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
    if (dx === 0 && dy === 0) return;

    // Snap to the nearest of 8 directions so diagonal movement feels
    // intentional and consistent rather than analog.
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    dx = Math.cos(angle);
    dy = Math.sin(angle);

    if (p.role === 'survivor') p.lastAim = angle;
    const actualSpeed = speed * (p.sprintState === 'active' ? SPRINT_MULTIPLIER : 1);
    const nx = p.x + dx * actualSpeed * DT;
    if (fits(grid, nx, p.y, radius)) p.x = nx;
    const ny = p.y + dy * actualSpeed * DT;
    if (fits(grid, p.x, ny, radius)) p.y = ny;
  }

  resolveObjectives() {
    const survivors = [...this.players.values()].filter(p => p.role === 'survivor' && p.alive);
    for (const obj of this.objectives) {
      if (obj.done) continue;
      let workers = 0;
      for (const s of survivors) {
        if (s.input.action && Math.hypot(s.x - obj.x, s.y - obj.y) <= OBJECTIVE_RADIUS) workers++;
      }
      if (workers > 0) {
        const rate = Math.min(OBJECTIVE_MAX_RATE, 1 + 0.5 * (workers - 1));
        obj.progress += DT * rate;
        if (obj.progress >= OBJECTIVE_TIME) { obj.progress = OBJECTIVE_TIME; obj.done = true; }
      }
    }
  }

  checkWin() {
    if (this.phase !== PHASE.PLAYING) return;
    const survivors = [...this.players.values()].filter(p => p.role === 'survivor');
    const aliveSurvivors = survivors.filter(p => p.alive);
    const killerPresent = [...this.players.values()].some(p => p.role === 'killer');
    const doneCount = this.objectives.filter(o => o.done).length;

    if (!killerPresent) { this.endRound('survivors'); return; }
    if (survivors.length === 0) { this.endRound('killer'); return; }
    if (doneCount >= this.objectives.length) { this.endRound('survivors'); return; }
    if (aliveSurvivors.length === 0) { this.endRound('killer'); return; }
  }

  endRound(winner) {
    this.phase = PHASE.OVER;
    this.winner = winner;
    this.broadcast({ t: 'over', winner });
  }

  // ---- networking ----

  serializePlayers() {
    const out = [];
    for (const p of this.players.values()) {
      if (p.role === null) continue;
      const entry = {
        id: p.id,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        alive: p.alive,
      };
      if (p.role === 'survivor') entry.hp = p.hp;
      const aimVal = p.role === 'killer' ? p.input.aim : p.lastAim;
      entry.aim = Math.round(aimVal * 100) / 100;
      entry.sprint = p.sprintState;
      if (p.role === 'killer') {
        entry.swing = p.swing;
        entry.lunging = this.elapsed < p.lungeUntil;
      }
      out.push(entry);
    }
    return out;
  }

  broadcastState() {
    this.broadcast({
      t: 'state',
      players: this.serializePlayers(),
      objectives: this.objectives.map(o => ({
        progress: Math.round((o.progress / OBJECTIVE_TIME) * 100) / 100,
        done: o.done,
      })),
    });
  }

  broadcastLobby() {
    const list = [...this.players.values()].map(p => ({ id: p.id, name: p.name, host: p.host }));
    this.broadcast({ t: 'lobby', players: list, canStart: list.length >= MIN_PLAYERS_TO_START });
  }

  broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const p of this.players.values()) {
      if (p.ws.readyState === 1) p.ws.send(data);
    }
  }

  sendTo(id, obj) {
    const p = this.players.get(id);
    if (p && p.ws.readyState === 1) p.ws.send(JSON.stringify(obj));
  }
}
