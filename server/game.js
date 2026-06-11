// The Room holds all authoritative game state for a single match. One Room.
//
// Survivor life cycle: up -> (3 hits) -> downed -> (bleed out) -> dead,
// or downed -> (teammate revive) -> up. When every generator is done an exit
// opens; each survivor channels at it to escape. The round ends when no
// survivor is still 'up': survivors win if anyone escaped, killer wins
// otherwise. The killer also sees noise pings from sprinting and repairing.

import {
  DT, KILLER_RADIUS, SURVIVOR_RADIUS, KILLER_SPEED, SURVIVOR_SPEED,
  SURVIVOR_HP, ATTACK_RANGE, ATTACK_ARC, ATTACK_COOLDOWN, HIT_INVULN, KNOCKBACK,
  LUNGE_SPEED, LUNGE_DURATION, LUNGE_COOLDOWN,
  SPRINT_MULTIPLIER, SPRINT_DURATION, SPRINT_COOLDOWN,
  OBJECTIVE_RADIUS, OBJECTIVE_TIME, OBJECTIVE_MAX_RATE,
  BLEEDOUT_TIME, REVIVE_TIME, REVIVE_RADIUS, REVIVE_HP,
  ESCAPE_TIME, EXIT_RADIUS,
  NOISE_SPRINT_INTERVAL, NOISE_REPAIR_INTERVAL,
  MIN_PLAYERS_TO_START,
} from './constants.js';
import { buildMap, pickSpawns, sampleObjectives, sampleCrates } from './map.js';

const PHASE = { LOBBY: 'lobby', PLAYING: 'playing', OVER: 'over' };

function solid(grid, px, py, tile) {
  const tx = Math.floor(px / tile);
  const ty = Math.floor(py / tile);
  if (ty < 0 || ty >= grid.length || tx < 0 || tx >= grid[0].length) return true;
  return grid[ty][tx] === '#';
}

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

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function emptyInput() {
  return { up: false, down: false, left: false, right: false, action: false, attack: false, lunge: false, sprint: false, aim: 0 };
}

export class Room {
  constructor() {
    this.players = new Map();
    this.phase = PHASE.LOBBY;
    this.map = null;
    this.objectives = [];
    this.crates = [];
    this.exit = null;          // {x,y} once all generators are done
    this.noises = [];          // pings emitted this tick, sent to the killer
    this.winner = null;
    this.elapsed = 0;
    this.killerElect = null;
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
      state: 'up',             // 'up' | 'downed' | 'dead' | 'escaped'
      input: emptyInput(),
      prevLunge: false,
      lastAttackAt: -999,
      lastLungeAt: -999,
      lungeUntil: 0,
      lungeDirX: 0, lungeDirY: 0,
      lungeHitDone: false,
      invulnUntil: 0,
      swing: false,
      lastAim: Math.PI / 2,
      sprintState: 'ready',
      sprintUntil: 0,
      sprintCooldownUntil: 0,
      bleedOutAt: 0,
      reviveProgress: 0,
      escapeProgress: 0,
      lastNoiseAt: -999,
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
    if (this.killerElect === id) this.killerElect = null;
    if (wasHost) {
      const next = this.players.values().next().value;
      if (next) next.host = true;
    }
    if (wasPlaying) this.checkWin();
    if (this.phase === PHASE.PLAYING) this.broadcastState();
    else this.broadcastLobby();
  }

  claimKiller(id) {
    if (!this.players.has(id)) return;
    if (this.phase === PHASE.PLAYING) return;
    this.killerElect = this.killerElect === id ? null : id;
    this.broadcastLobby();
  }

  // ---- input ----

  setInput(id, msg) {
    const p = this.players.get(id);
    if (!p || p.role === null || this.phase !== PHASE.PLAYING) return;
    p.input = {
      up: !!msg.up, down: !!msg.down, left: !!msg.left, right: !!msg.right,
      action: !!msg.action, attack: !!msg.attack, lunge: !!msg.lunge, sprint: !!msg.sprint,
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
    this.exit = null;
    this.noises = [];

    const spawns = pickSpawns(this.map);
    const ids = [...this.players.keys()];

    const killerId = (this.killerElect !== null && this.players.has(this.killerElect))
      ? this.killerElect : id;

    const ring = [
      [0, 0], [34, 0], [-34, 0], [0, 34], [0, -34],
      [34, 34], [-34, -34], [34, -34], [-34, 34],
    ];
    let ringIndex = 0;

    for (const pid of ids) {
      const pl = this.players.get(pid);
      pl.hp = SURVIVOR_HP;
      pl.state = 'up';
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
      pl.bleedOutAt = 0;
      pl.reviveProgress = 0;
      pl.escapeProgress = 0;
      pl.lastNoiseAt = -999;

      if (pid === killerId) {
        pl.role = 'killer';
        pl.x = spawns.killerAnchor.x;
        pl.y = spawns.killerAnchor.y;
      } else {
        pl.role = 'survivor';
        let placed = false;
        while (ringIndex < ring.length && !placed) {
          const [ox, oy] = ring[ringIndex++];
          const sx = spawns.survivorAnchor.x + ox;
          const sy = spawns.survivorAnchor.y + oy;
          if (fits(this.map.grid, sx, sy, SURVIVOR_RADIUS)) { pl.x = sx; pl.y = sy; placed = true; }
        }
        if (!placed) { pl.x = spawns.survivorAnchor.x; pl.y = spawns.survivorAnchor.y; }
      }
    }

    const genCount = this.players.size;
    const spots = sampleObjectives(this.map, genCount);
    this.objectives = spots.map(s => ({ x: s.x, y: s.y, progress: 0, done: false }));
    this.crates = sampleCrates(this.map, 24);

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
      bleedoutTime: BLEEDOUT_TIME,
      reviveTime: REVIVE_TIME,
      reviveRadius: REVIVE_RADIUS,
      escapeTime: ESCAPE_TIME,
      exitRadius: EXIT_RADIUS,
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
        crates: this.crates,
        players: roster,
      });
    }
    this.broadcastState();
  }

  // ---- simulation ----

  update() {
    if (this.phase !== PHASE.PLAYING) return;
    this.elapsed += DT;
    this.noises = [];

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

    this.tickBleedouts();
    this.resolveActions();
    this.maybeOpenExit();
    this.checkWin();

    if (this.phase === PHASE.PLAYING) {
      this.broadcastState();
      for (const p of this.players.values()) p.swing = false;
    }
  }

  handleKillerActions(k) {
    if (k.input.attack && this.elapsed - k.lastAttackAt >= ATTACK_COOLDOWN && this.elapsed >= k.lungeUntil) {
      this.swing(k);
    }
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
      if (s.role !== 'survivor' || s.state !== 'up' || this.elapsed < s.invulnUntil) continue;
      const dx = s.x - k.x, dy = s.y - k.y;
      const d = Math.hypot(dx, dy);
      if (d > ATTACK_RANGE + SURVIVOR_RADIUS) continue;
      if (Math.abs(angleDiff(Math.atan2(dy, dx), k.input.aim)) <= ATTACK_ARC) {
        this.hit(s, dx, dy, d);
      }
    }
  }

  hit(s, dx, dy, d) {
    s.hp -= 1;
    s.invulnUntil = this.elapsed + HIT_INVULN;
    const len = d || 1;
    this.knockback(s, dx / len, dy / len);
    if (s.hp <= 0) {
      s.hp = 0;
      s.state = 'downed';
      s.bleedOutAt = this.elapsed + BLEEDOUT_TIME;
      s.reviveProgress = 0;
    }
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

  tickSprint(p) {
    if (p.sprintState === 'active' && this.elapsed >= p.sprintUntil) {
      p.sprintState = 'cooldown';
      p.sprintCooldownUntil = this.elapsed + SPRINT_COOLDOWN;
    } else if (p.sprintState === 'cooldown' && this.elapsed >= p.sprintCooldownUntil) {
      p.sprintState = 'ready';
    }
    const notLunging = p.role !== 'killer' || this.elapsed >= p.lungeUntil;
    if (p.input.sprint && p.sprintState === 'ready' && notLunging) {
      p.sprintState = 'active';
      p.sprintUntil = this.elapsed + SPRINT_DURATION;
    }
    if (!p.input.sprint && p.sprintState === 'active') {
      p.sprintState = 'cooldown';
      p.sprintCooldownUntil = this.elapsed + SPRINT_COOLDOWN;
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
          if (s.role !== 'survivor' || s.state !== 'up' || this.elapsed < s.invulnUntil) continue;
          const dx = s.x - k.x, dy = s.y - k.y;
          const d = Math.hypot(dx, dy);
          if (d <= KILLER_RADIUS + SURVIVOR_RADIUS + 2) {
            this.hit(s, dx, dy, d);
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
    if (s.state !== 'up') return;
    this.applyInputMove(s, SURVIVOR_SPEED, SURVIVOR_RADIUS);
  }

  applyInputMove(p, speed, radius) {
    const grid = this.map.grid;
    let dx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
    let dy = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
    if (dx === 0 && dy === 0) return;

    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    dx = Math.cos(angle);
    dy = Math.sin(angle);

    if (p.role === 'survivor') p.lastAim = angle;
    const sprinting = p.sprintState === 'active';
    const actualSpeed = speed * (sprinting ? SPRINT_MULTIPLIER : 1);
    const nx = p.x + dx * actualSpeed * DT;
    if (fits(grid, nx, p.y, radius)) p.x = nx;
    const ny = p.y + dy * actualSpeed * DT;
    if (fits(grid, p.x, ny, radius)) p.y = ny;

    // Sprinting is loud.
    if (sprinting && this.elapsed - p.lastNoiseAt >= NOISE_SPRINT_INTERVAL) {
      p.lastNoiseAt = this.elapsed;
      this.noises.push({ x: Math.round(p.x), y: Math.round(p.y) });
    }
  }

  tickBleedouts() {
    for (const s of this.players.values()) {
      if (s.role !== 'survivor' || s.state !== 'downed') continue;
      if (this.elapsed >= s.bleedOutAt) s.state = 'dead';
    }
  }

  // One action key, resolved by priority for each up survivor holding it:
  // 1) revive a downed ally in range, 2) channel escape at an open exit,
  // 3) repair a generator in range.
  resolveActions() {
    const survivors = [...this.players.values()].filter(p => p.role === 'survivor');
    const up = survivors.filter(s => s.state === 'up');
    const downed = survivors.filter(s => s.state === 'downed');

    const genWorkers = new Map();   // objective -> worker count

    for (const s of up) {
      if (!s.input.action) continue;

      const ally = downed.find(d => dist(s, d) <= REVIVE_RADIUS);
      if (ally) {
        ally.reviveProgress += DT;
        if (ally.reviveProgress >= REVIVE_TIME) {
          ally.state = 'up';
          ally.hp = REVIVE_HP;
          ally.reviveProgress = 0;
          ally.invulnUntil = this.elapsed + HIT_INVULN;
        }
        continue;
      }

      if (this.exit && dist(s, this.exit) <= EXIT_RADIUS) {
        s.escapeProgress += DT;
        if (s.escapeProgress >= ESCAPE_TIME) s.state = 'escaped';
        continue;
      }

      const obj = this.objectives.find(o => !o.done && dist(s, o) <= OBJECTIVE_RADIUS);
      if (obj) {
        genWorkers.set(obj, (genWorkers.get(obj) || 0) + 1);
        // Repairing is loud.
        if (this.elapsed - s.lastNoiseAt >= NOISE_REPAIR_INTERVAL) {
          s.lastNoiseAt = this.elapsed;
          this.noises.push({ x: Math.round(s.x), y: Math.round(s.y) });
        }
      }
    }

    for (const [obj, workers] of genWorkers) {
      const rate = Math.min(OBJECTIVE_MAX_RATE, 1 + 0.5 * (workers - 1));
      obj.progress += DT * rate;
      if (obj.progress >= OBJECTIVE_TIME) { obj.progress = OBJECTIVE_TIME; obj.done = true; }
    }
  }

  maybeOpenExit() {
    if (this.exit) return;
    if (this.objectives.length === 0) return;
    if (!this.objectives.every(o => o.done)) return;
    // The exit opens at a random generator-style spot.
    const spot = sampleObjectives(this.map, 1)[0];
    this.exit = { x: spot.x, y: spot.y };
  }

  checkWin() {
    if (this.phase !== PHASE.PLAYING) return;
    const survivors = [...this.players.values()].filter(p => p.role === 'survivor');
    const killerPresent = [...this.players.values()].some(p => p.role === 'killer');

    if (!killerPresent) { this.endRound('survivors'); return; }
    if (survivors.length === 0) { this.endRound('killer'); return; }

    const upCount = survivors.filter(s => s.state === 'up').length;
    const escaped = survivors.filter(s => s.state === 'escaped').length;

    // Round ends when nobody is left standing: anyone downed has no rescuer
    // and will bleed out, so the result is already decided.
    if (upCount === 0) {
      this.endRound(escaped > 0 ? 'survivors' : 'killer');
    }
  }

  endRound(winner) {
    this.phase = PHASE.OVER;
    this.winner = winner;
    this.broadcast({ t: 'over', winner });
    this.broadcastLobby();
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
        state: p.state,
        sprint: p.sprintState,
      };
      const aimVal = p.role === 'killer' ? p.input.aim : p.lastAim;
      entry.aim = Math.round(aimVal * 100) / 100;
      if (p.role === 'survivor') {
        entry.hp = p.hp;
        if (p.state === 'downed') {
          entry.bleed = Math.round(Math.max(0, (p.bleedOutAt - this.elapsed) / BLEEDOUT_TIME) * 100) / 100;
          entry.revive = Math.round((p.reviveProgress / REVIVE_TIME) * 100) / 100;
        }
        if (this.exit) {
          entry.esc = Math.round((p.escapeProgress / ESCAPE_TIME) * 100) / 100;
        }
      }
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
      exit: this.exit,
      noises: this.noises,
    });
  }

  broadcastLobby() {
    const list = [...this.players.values()].map(p => ({ id: p.id, name: p.name, host: p.host }));
    this.broadcast({ t: 'lobby', players: list, canStart: list.length >= MIN_PLAYERS_TO_START, killer: this.killerElect });
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
