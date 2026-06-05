// Client-side view of the world. The server is authoritative; this class makes
// it feel smooth: remote players are interpolated between the two latest server
// snapshots, and the local player is predicted from input each frame and gently
// corrected toward the server's truth.

import { CORRECTION } from './constants.js';

export class Game {
  constructor() {
    this.you = null;
    this.role = null;
    this.config = null;
    this.map = null;          // { cols, rows, tiles: [rowStrings] }
    this.roles = new Map();   // id -> 'killer' | 'survivor'
    this.names = new Map();   // id -> name
    this.objectives = [];     // [{ x, y, progress(0..1), done }]

    this.prev = null;         // previous snapshot { time, players: Map }
    this.curr = null;         // latest snapshot
    this.local = null;        // predicted local position { x, y }
    this.localAlive = true;
  }

  onInit(msg) {
    this.you = msg.you;
    this.role = msg.role;
    this.config = msg.config;
    this.map = msg.map;
    this.roles = new Map(msg.players.map(p => [p.id, p.role]));
    this.names = new Map(msg.players.map(p => [p.id, p.name]));
    this.objectives = msg.objectives.map(o => ({ x: o.x, y: o.y, progress: 0, done: false }));
    this.prev = null;
    this.curr = null;
    this.local = null;
    this.localAlive = true;
  }

  onState(msg) {
    const players = new Map();
    for (const p of msg.players) players.set(p.id, { x: p.x, y: p.y, alive: p.alive });

    this.prev = this.curr;
    this.curr = { time: performance.now(), players };

    // objectives line up by index with init
    msg.objectives.forEach((o, i) => {
      if (this.objectives[i]) { this.objectives[i].progress = o.progress; this.objectives[i].done = o.done; }
    });

    const mine = players.get(this.you);
    if (mine) {
      this.localAlive = mine.alive;
      if (!this.local) this.local = { x: mine.x, y: mine.y };
      else {
        this.local.x += (mine.x - this.local.x) * CORRECTION;
        this.local.y += (mine.y - this.local.y) * CORRECTION;
      }
    }
  }

  // ---- local prediction ----

  solidAt(px, py) {
    const t = this.config.tile;
    const tx = Math.floor(px / t);
    const ty = Math.floor(py / t);
    if (ty < 0 || ty >= this.map.rows || tx < 0 || tx >= this.map.cols) return true;
    return this.map.tiles[ty][tx] === '#';
  }

  fits(x, y) {
    const r = this.config.playerRadius;
    return (
      !this.solidAt(x - r, y - r) && !this.solidAt(x + r, y - r) &&
      !this.solidAt(x - r, y + r) && !this.solidAt(x + r, y + r)
    );
  }

  predict(dt, input) {
    if (!this.local || !this.localAlive) return;
    const speed = this.role === 'killer' ? this.config.killerSpeed : this.config.survivorSpeed;
    let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (dx === 0 && dy === 0) return;
    const len = Math.hypot(dx, dy);
    dx /= len; dy /= len;
    const nx = this.local.x + dx * speed * dt;
    if (this.fits(nx, this.local.y)) this.local.x = nx;
    const ny = this.local.y + dy * speed * dt;
    if (this.fits(this.local.x, ny)) this.local.y = ny;
  }

  // ---- read for rendering ----

  // Returns the position the local player should be drawn at this frame.
  selfPos() {
    if (this.local) return this.local;
    if (this.curr) { const m = this.curr.players.get(this.you); if (m) return { x: m.x, y: m.y }; }
    return { x: 0, y: 0 };
  }

  // Interpolated list of every player for rendering.
  renderPlayers(now) {
    if (!this.curr) return [];
    let alpha = 1;
    if (this.prev && this.curr.time > this.prev.time) {
      alpha = (now - this.curr.time) / (this.curr.time - this.prev.time);
      alpha = Math.max(0, Math.min(1, alpha));
    }
    const out = [];
    for (const [id, role] of this.roles) {
      if (id === this.you) {
        const c = this.curr.players.get(id);
        out.push({ id, role, ...this.selfPos(), alive: this.localAlive, self: true });
        continue;
      }
      const cur = this.curr.players.get(id);
      if (!cur) continue;
      const pr = this.prev ? this.prev.players.get(id) : null;
      const x = pr ? pr.x + (cur.x - pr.x) * alpha : cur.x;
      const y = pr ? pr.y + (cur.y - pr.y) * alpha : cur.y;
      out.push({ id, role, x, y, alive: cur.alive, self: false });
    }
    return out;
  }

  doneCount() { return this.objectives.filter(o => o.done).length; }
  aliveSurvivors() {
    let n = 0;
    for (const [id, role] of this.roles) {
      if (role !== 'survivor') continue;
      const p = this.curr && this.curr.players.get(id);
      if (id === this.you ? this.localAlive : (p && p.alive)) n++;
    }
    return n;
  }
}
