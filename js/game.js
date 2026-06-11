// Client-side view of the world. Server is authoritative; this smooths it and
// tracks the local player's life-cycle state: up, downed, dead, escaped.

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
    this.exit = null;
    this.noises = [];           // recent noise pings (killer only), {x,y,at}
    this.prev = null;
    this.curr = null;
    this.local = null;
    this.localState = 'up';
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
    this.exit = null;
    this.noises = [];
    this.prev = null;
    this.curr = null;
    this.local = null;
    this.localState = 'up';
    this.localHp = msg.config.survivorHp;
    this.spectateId = null;
    this.sprintState = 'ready';
    this.sprintUntil = 0;
    this.sprintCooldownUntil = 0;
    this.clientElapsed = 0;
  }

  onState(msg) {
    const players = new Map();
    for (const p of msg.players) players.set(p.id, p);

    this.prev = this.curr;
    this.curr = { time: performance.now(), players };
    this.exit = msg.exit || null;

    if (this.role === 'killer' && msg.noises && msg.noises.length) {
      const now = performance.now();
      for (const n of msg.noises) this.noises.push({ x: n.x, y: n.y, at: now });
    }
    // Drop pings older than 1.2s.
    const cutoff = performance.now() - 1200;
    this.noises = this.noises.filter(n => n.at >= cutoff);

    msg.objectives.forEach((o, i) => {
      if (this.objectives[i]) { this.objectives[i].progress = o.progress; this.objectives[i].done = o.done; }
    });

    const mine = players.get(this.you);
    if (mine) {
      this.localState = mine.state;
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
    if (!this.local || this.localState !== 'up') return;
    this.clientElapsed += dt;
    const e = this.clientElapsed;
    const cfg = this.config;

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

  selfEntry() { return this.curr ? this.curr.players.get(this.you) : null; }

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
      if (!cur) continue;
      if (cur.state === 'escaped') continue;   // escaped survivors leave the field
      if (id === this.you) {
        const pos = this.selfPos();
        out.push({ ...cur, role, x: pos.x, y: pos.y, self: true });
        continue;
      }
      const pos = this.interpPos(id, now);
      out.push({ ...cur, role, x: pos.x, y: pos.y, self: false });
    }
    return out;
  }

  // ---- spectator (dead or escaped players watch the living) ----

  spectatable() {
    const ids = [];
    for (const [id] of this.roles) {
      if (id === this.you) continue;
      const p = this.curr && this.curr.players.get(id);
      if (p && (p.state === 'up' || p.state === 'downed')) ids.push(id);
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
    // Up and downed players watch themselves; dead and escaped spectate.
    if (this.localState === 'up' || this.localState === 'downed') return this.selfPos();
    if (!this.spectateId || !this.spectatable().includes(this.spectateId)) this.cycleSpectate(1);
    const p = this.spectateId ? this.interpPos(this.spectateId, now) : null;
    return p || this.selfPos();
  }

  fogMode() {
    if (this.localState === 'downed') return 'downed';
    if (this.localState === 'dead' || this.localState === 'escaped') return 'spectate';
    return this.role;
  }

  doneCount() { return this.objectives.filter(o => o.done).length; }

  upSurvivors() {
    let n = 0;
    for (const [id, role] of this.roles) {
      if (role !== 'survivor') continue;
      const p = id === this.you
        ? { state: this.localState }
        : (this.curr && this.curr.players.get(id));
      if (p && p.state === 'up') n++;
    }
    return n;
  }

  // Nearest interactable for the prompt: downed ally, open exit, or generator.
  actionTarget() {
    if (this.role !== 'survivor' || this.localState !== 'up' || !this.curr) return null;
    const self = this.selfPos();
    const d = (o) => Math.hypot(self.x - o.x, self.y - o.y);

    for (const [id, role] of this.roles) {
      if (role !== 'survivor' || id === this.you) continue;
      const p = this.curr.players.get(id);
      if (p && p.state === 'downed' && d(p) <= this.config.reviveRadius) {
        return { kind: 'revive', x: p.x, y: p.y };
      }
    }
    if (this.exit && d(this.exit) <= this.config.exitRadius) {
      return { kind: 'escape', x: this.exit.x, y: this.exit.y };
    }
    for (const o of this.objectives) {
      if (!o.done && d(o) <= this.config.objectiveRadius) {
        return { kind: 'repair', x: o.x, y: o.y };
      }
    }
    return null;
  }
}
