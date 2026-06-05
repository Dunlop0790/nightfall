// The Room holds all authoritative game state for a single match and is the
// only place game rules live. server.js just feeds it connections, messages,
// and a tick. There is one Room for this demo.

import {
  DT, TILE, PLAYER_RADIUS, KILLER_SPEED, SURVIVOR_SPEED,
  CATCH_RADIUS, OBJECTIVE_RADIUS, OBJECTIVE_TIME, OBJECTIVES_TO_WIN,
  MIN_PLAYERS_TO_START,
} from './constants.js';
import { buildMap, sampleObjectives } from './map.js';

const PHASE = { LOBBY: 'lobby', PLAYING: 'playing', OVER: 'over' };

// Collision: a point is solid if its tile is a wall or out of bounds.
function solid(grid, px, py) {
  const tx = Math.floor(px / TILE);
  const ty = Math.floor(py / TILE);
  if (ty < 0 || ty >= grid.length || tx < 0 || tx >= grid[0].length) return true;
  return grid[ty][tx] === '#';
}

// A circle (player) fits at (x,y) if none of its four corners hit a wall.
function fits(grid, x, y) {
  const r = PLAYER_RADIUS;
  return (
    !solid(grid, x - r, y - r) &&
    !solid(grid, x + r, y - r) &&
    !solid(grid, x - r, y + r) &&
    !solid(grid, x + r, y + r)
  );
}

function emptyInput() {
  return { up: false, down: false, left: false, right: false, action: false };
}

export class Room {
  constructor() {
    this.players = new Map();   // id -> player
    this.phase = PHASE.LOBBY;
    this.map = null;
    this.objectives = [];       // [{ x, y, progress, done }]
    this.winner = null;
  }

  // ---- connection lifecycle ----

  addPlayer(id, name, ws) {
    if (this.players.has(id)) return;
    const isFirst = this.players.size === 0;
    this.players.set(id, {
      id, name, ws,
      host: isFirst,
      role: null,            // assigned at round start
      x: 0, y: 0,
      alive: true,
      input: emptyInput(),
    });

    if (this.phase === PHASE.PLAYING) {
      // Late joiner waits for the next round.
      this.sendTo(id, { t: 'wait' });
    }
    this.broadcastLobby();
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    const wasHost = p.host;
    const wasPlaying = this.phase === PHASE.PLAYING && p.role !== null;
    this.players.delete(id);

    // Reassign host to whoever is now first in.
    if (wasHost) {
      const next = this.players.values().next().value;
      if (next) next.host = true;
    }

    if (wasPlaying) this.checkWin(); // a departure can end the round
    if (this.phase === PHASE.PLAYING) this.broadcastState();
    else this.broadcastLobby();
  }

  // ---- input ----

  setInput(id, msg) {
    const p = this.players.get(id);
    if (!p || p.role === null || this.phase !== PHASE.PLAYING) return;
    p.input = {
      up: !!msg.up,
      down: !!msg.down,
      left: !!msg.left,
      right: !!msg.right,
      action: !!msg.action,
    };
  }

  // ---- round control ----

  start(id) {
    const p = this.players.get(id);
    if (!p || !p.host) return;                       // only the host starts
    if (this.phase === PHASE.PLAYING) return;
    if (this.players.size < MIN_PLAYERS_TO_START) return;

    this.map = buildMap();
    this.winner = null;

    // First player (the host) is the killer, everyone else survives.
    const ids = [...this.players.keys()];
    let survivorIndex = 0;
    for (const pid of ids) {
      const pl = this.players.get(pid);
      pl.alive = true;
      pl.input = emptyInput();
      if (pid === id) {
        pl.role = 'killer';
        pl.x = this.map.killerSpawn.x;
        pl.y = this.map.killerSpawn.y;
      } else {
        pl.role = 'survivor';
        const spawn = this.map.survivorSpawns[survivorIndex % this.map.survivorSpawns.length];
        survivorIndex++;
        pl.x = spawn.x;
        pl.y = spawn.y;
      }
    }

    const spots = sampleObjectives(this.map, OBJECTIVES_TO_WIN);
    this.objectives = spots.map(s => ({ x: s.x, y: s.y, progress: 0, done: false }));

    this.phase = PHASE.PLAYING;

    const config = {
      tile: TILE,
      playerRadius: PLAYER_RADIUS,
      killerSpeed: KILLER_SPEED,
      survivorSpeed: SURVIVOR_SPEED,
      objectiveRadius: OBJECTIVE_RADIUS,
      objectiveTime: OBJECTIVE_TIME,
      objectivesToWin: OBJECTIVES_TO_WIN,
    };
    const roster = ids.map(pid => {
      const pl = this.players.get(pid);
      return { id: pl.id, name: pl.name, role: pl.role };
    });

    // Each player gets their own role in init.
    for (const pid of ids) {
      const pl = this.players.get(pid);
      this.sendTo(pid, {
        t: 'init',
        you: pid,
        role: pl.role,
        config,
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

    for (const p of this.players.values()) {
      if (p.role === null) continue;
      if (p.role === 'survivor' && !p.alive) continue;
      this.move(p);
    }

    this.resolveCatches();
    this.resolveObjectives();
    this.checkWin();

    if (this.phase === PHASE.PLAYING) this.broadcastState();
  }

  move(p) {
    const speed = p.role === 'killer' ? KILLER_SPEED : SURVIVOR_SPEED;
    let dx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
    let dy = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
    if (dx === 0 && dy === 0) return;

    const len = Math.hypot(dx, dy);
    dx /= len; dy /= len;

    const grid = this.map.grid;
    const nx = p.x + dx * speed * DT;
    if (fits(grid, nx, p.y)) p.x = nx;
    const ny = p.y + dy * speed * DT;
    if (fits(grid, p.x, ny)) p.y = ny;
  }

  resolveCatches() {
    const killer = [...this.players.values()].find(p => p.role === 'killer');
    if (!killer) return;
    for (const p of this.players.values()) {
      if (p.role !== 'survivor' || !p.alive) continue;
      if (Math.hypot(p.x - killer.x, p.y - killer.y) <= CATCH_RADIUS + PLAYER_RADIUS) {
        p.alive = false;
      }
    }
  }

  resolveObjectives() {
    const survivors = [...this.players.values()].filter(p => p.role === 'survivor' && p.alive);
    for (const obj of this.objectives) {
      if (obj.done) continue;
      const worker = survivors.find(
        s => s.input.action && Math.hypot(s.x - obj.x, s.y - obj.y) <= OBJECTIVE_RADIUS
      );
      if (worker) {
        obj.progress += DT;
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

    if (!killerPresent) { this.endRound('survivors'); return; }      // killer rage-quit
    if (survivors.length === 0) { this.endRound('killer'); return; } // everyone left
    if (doneCount >= OBJECTIVES_TO_WIN) { this.endRound('survivors'); return; }
    if (aliveSurvivors.length === 0) { this.endRound('killer'); return; }
  }

  endRound(winner) {
    this.phase = PHASE.OVER;
    this.winner = winner;
    this.broadcast({ t: 'over', winner });
  }

  // ---- networking helpers ----

  serializePlayers() {
    const out = [];
    for (const p of this.players.values()) {
      if (p.role === null) continue;
      out.push({
        id: p.id,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        alive: p.alive,
      });
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
    const list = [...this.players.values()].map(p => ({
      id: p.id, name: p.name, host: p.host,
    }));
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
