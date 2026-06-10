// Client-side view of the world. Server is authoritative; this smooths it:
// remote players interpolate between the two latest snapshots, the local player
// is predicted from input and corrected toward the server. Also tracks
// spectator focus once the local survivor is downed.

import { CORRECTION } from './constants.js';

export class Game {
  constructor() {
    this.you = null;
    this.role = null;
    this.config = null;
    this.map = null;
    this.roles = new Map();
    this.names = new Map();
    this.objectives = [];
    this.crates = [];
    this.prev = null;
    this.curr = null;
    this.local = null;
    this.localAlive = true;
    this.localHp = 0;
    this.spectateId = null;
    this.sprintState = 'ready';
    this.sprintUntil = 0;
    this.sprintCooldownUntil = 0;
    this.clientElapsed = 0;
  }

  onInit(msg) {
    this.you = msg.you;
    this.role = msg.role;
    this.config = msg.config;
    this.map = msg.map;
    this.roles = new Map(msg.players.map(p => [p.id, p.role]));
    this.names = new Map(msg.players.map(p => [p.id, p.name]));
    this.objectives = msg.objectives.map(o => ({ x: o.x, y: o.y, progress: 0, done: false }));
    this.crates = msg.crates || [];
    this.prev = null;
    this.curr = null;
    this.local = null;
    this.localAlive = true;
    this.localHp = msg.config.survivorHp;
    this.spectateId = null;
    this.sprintState = 'ready';
    this.sprintUntil = 0;
    this.sprintCooldownUntil = 0;
    this.clientElapsed = 0;
  }

  onState(msg) {
    const players = new Map();
    for (const p of msg.players) {
      players.set(p.id, { x: p.x, y: p.y, alive: p.alive, hp: p.hp, swing: p.swing, lunging: p.lunging, aim: p.aim });
    }
    this.prev = this.curr;
    this.curr = { time: performance.now(), players };

    msg.objectives.forEach((o, i) => {
      if (this.objectives[i]) { this.objectives[i].progress = o.progress; this.objectives[i].done = o.done; }
    });

    const mine = players.get(this.you);
    if (mine) {
      this.localAlive = mine.alive;
      if (typeof mine.hp === 'number') this.localHp = mine.hp;
      if (!this.local) this.local = { x: mine.x, y: mine.y };
      else {
        this.local.x += (mine.x - this.local.x) * CORRECTION;
        this.local.y += (mine.y - this.local.y) * CORRECTION;
      }
    }
  }

  // ---- local prediction ----

  radiusOf(role) { return role === 'killer' ? this.config.killerRadius : this.config.survivorRadius; }

  solidAt(px, py) {
    const t = 32;
    const tx = Math.floor(px / t);
    const ty = Math.floor(py / t);
    if (ty < 0 || ty >= this.map.rows || tx < 0 || tx >= this.map.cols) return true;
    return this.map.tiles[ty][tx] === '#';
  }

  fits(x, y, r) {
    return (
      !this.solidAt(x - r, y - r) && !this.solidAt(x + r, y - r) &&
      !this.solidAt(x - r, y + r) && !this.solidAt(x + r, y + r)
    );
  }

  predict(dt, input) {
    if (!this.local || !this.localAlive) return;
    this.clientElapsed += dt;
    const e = this.clientElapsed;
    const cfg = this.config;

    // Mirror server sprint state machine so local movement feels instant.
    if (this.sprintState === 'active' && e >= this.sprintUntil) {
      this.sprintState = 'cooldown';
      this.sprintCooldownUntil = e + cfg.sprintCooldown;
    } else if (this.sprintState === 'cooldown' && e >= this.sprintCooldownUntil) {
      this.sprintState = 'ready';
    }
    if (input.sprint && this.sprintState === 'ready') {
      this.sprintState = 'active';
      this.sprintUntil = e + cfg.sprintDuration;
    }
    if (!input.sprint && this.sprintState === 'active') {
      this.sprintState = 'cooldown';
      this.sprintCooldownUntil = e + cfg.sprintCooldown;
    }

    const baseSpeed = this.role === 'killer' ? cfg.killerSpeed : cfg.survivorSpeed;
    const speed = baseSpeed * (this.sprintState === 'active' ? cfg.sprintMultiplier : 1);
    const r = this.radiusOf(this.role);
    let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    if (dx === 0 && dy === 0) return;
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    dx = Math.cos(angle);
    dy = Math.sin(angle);
    const nx = this.local.x + dx * speed * dt;
    if (this.fits(nx, this.local.y, r)) this.local.x = nx;
    const ny = this.local.y + dy * speed * dt;
    if (this.fits(this.local.x, ny, r)) this.local.y = ny;
  }

  sprintInfo() {
    const e = this.clientElapsed;
    if (this.sprintState === 'active') return { state: 'active', remaining: Math.max(0, this.sprintUntil - e) };
    if (this.sprintState === 'cooldown') return { state: 'cooldown', remaining: Math.max(0, this.sprintCooldownUntil - e) };
    return { state: 'ready', remaining: 0 };
  }

  // ---- read for rendering ----

  selfPos() {
    if (this.local) return this.local;
    if (this.curr) { const m = this.curr.players.get(this.you); if (m) return { x: m.x, y: m.y }; }
    return { x: 0, y: 0 };
  }

  alpha(now) {
    if (this.prev && this.curr && this.curr.time > this.prev.time) {
      return Math.max(0, Math.min(1, (now - this.curr.time) / (this.curr.time - this.prev.time)));
    }
    return 1;
  }

  interpPos(id, now) {
    if (!this.curr) return null;
    const cur = this.curr.players.get(id);
    if (!cur) return null;
    const pr = this.prev ? this.prev.players.get(id) : null;
    const a = this.alpha(now);
    return {
      x: pr ? pr.x + (cur.x - pr.x) * a : cur.x,
      y: pr ? pr.y + (cur.y - pr.y) * a : cur.y,
    };
  }

  renderPlayers(now) {
    if (!this.curr) return [];
    const out = [];
    for (const [id, role] of this.roles) {
      const cur = this.curr.players.get(id);
      if (id === this.you) {
        const pos = this.selfPos();
        out.push({ id, role, x: pos.x, y: pos.y, alive: this.localAlive, hp: this.localHp, self: true, swing: cur ? cur.swing : false, lunging: cur ? cur.lunging : false, aim: cur ? cur.aim : 0 });
        continue;
      }
      if (!cur) continue;
      const pos = this.interpPos(id, now);
      out.push({ id, role, x: pos.x, y: pos.y, alive: cur.alive, hp: cur.hp, self: false, swing: cur.swing, lunging: cur.lunging, aim: cur.aim });
    }
    return out;
  }

  // ---- spectator ----

  // Other players still in the round that a downed survivor can watch.
  spectatable() {
    const ids = [];
    for (const [id, role] of this.roles) {
      if (id === this.you) continue;
      const p = this.curr && this.curr.players.get(id);
      if (p && p.alive) ids.push(id);
    }
    return ids;
  }

  cycleSpectate(dir) {
    const ids = this.spectatable();
    if (ids.length === 0) { this.spectateId = null; return; }
    let i = ids.indexOf(this.spectateId);
    if (i === -1) i = 0;
    else i = (i + dir + ids.length) % ids.length;
    this.spectateId = ids[i];
  }

  focusPos(now) {
    if (this.localAlive) return this.selfPos();
    if (!this.spectateId || !this.spectatable().includes(this.spectateId)) this.cycleSpectate(1);
    const p = this.spectateId ? this.interpPos(this.spectateId, now) : null;
    return p || this.selfPos();
  }

  fogMode() { return this.localAlive ? this.role : 'spectate'; }

  doneCount() { return this.objectives.filter(o => o.done).length; }

  aliveSurvivors() {
    let n = 0;
    for (const [id, role] of this.roles) {
      if (role !== 'survivor') continue;
      if (id === this.you) { if (this.localAlive) n++; continue; }
      const p = this.curr && this.curr.players.get(id);
      if (p && p.alive) n++;
    }
    return n;
  }

  // Nearest unfinished objective the local survivor is standing in, for the prompt.
  objectiveInRange() {
    if (this.role !== 'survivor' || !this.localAlive) return null;
    const self = this.selfPos();
    const r = this.config.objectiveRadius;
    for (const o of this.objectives) {
      if (o.done) continue;
      if (Math.hypot(self.x - o.x, self.y - o.y) <= r) return o;
    }
    return null;
  }
}
