// Draws the world, players by state, props, the exit, killer noise pings, and
// the fog overlay. All sprites come from the manifest in assets.js; a missing
// file renders as a labelled placeholder box so art can be dropped in anytime.

import {
  KILLER_VIEW, FLASH_RANGE, FLASH_HALF_ANGLE, SELF_GLOW, SPECTATE_VIEW, FOG_ALPHA,
  COLORS, hpColor,
} from './constants.js';
import { SPRITES, PLACEHOLDER_COLORS } from './assets.js';

const SWING_ARC = 0.7;
const TILE = 32;

// Killer menace effects.
const KILLER_GLOW_SCALE = 5.0;   // aura radius as a multiple of body radius
const PANIC_RANGE = 460;         // px at which the survivor panic vignette starts

// Survivor fog darkness (lower = survivors see more of the map). Killer keeps
// the full FOG_ALPHA from constants.js.
const SURVIVOR_FOG_ALPHA = 0.9;

// Character sheets: 4 frames left-to-right: down, right, up, left.
const FRAME_X = { down: 0, right: 1, up: 2, left: 3 };
function frameFor(dir) {
  if (dir === 'down' || dir === 'down-left' || dir === 'down-right') return FRAME_X.down;
  if (dir === 'up' || dir === 'up-left' || dir === 'up-right') return FRAME_X.up;
  if (dir === 'right') return FRAME_X.right;
  return FRAME_X.left;
}

function facingDir(aim) {
  const a = ((aim % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const e = Math.PI / 4;
  if (a < e / 2 || a >= 2 * Math.PI - e / 2) return 'right';
  if (a < e + e / 2) return 'down-right';
  if (a < 2 * e + e / 2) return 'down';
  if (a < 3 * e + e / 2) return 'down-left';
  if (a < 4 * e + e / 2) return 'left';
  if (a < 5 * e + e / 2) return 'up-left';
  if (a < 6 * e + e / 2) return 'up';
  if (a < 7 * e + e / 2) return 'up-right';
  return 'right';
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fog = document.createElement('canvas');
    this.fogCtx = this.fog.getContext('2d');
    this.scratch = document.createElement('canvas');
    this.scratch.width = 64; this.scratch.height = 64;
    this.scratchCtx = this.scratch.getContext('2d');

    // Load every slot in the manifest; build a placeholder for each in case
    // the file is missing.
    this.sprites = {};
    for (const [name, def] of Object.entries(SPRITES)) {
      const img = new Image();
      img.src = def.src;
      this.sprites[name] = { img, def, placeholder: this.makePlaceholder(name, def) };
    }

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  makePlaceholder(name, def) {
    const single = def.size || def.frame;
    const frames = def.frame ? 4 : 1;
    const c = document.createElement('canvas');
    c.width = single * frames;
    c.height = single;
    const cx = c.getContext('2d');
    for (let f = 0; f < frames; f++) {
      const x = f * single;
      cx.fillStyle = PLACEHOLDER_COLORS[name] || '#666';
      cx.fillRect(x, 0, single, single);
      cx.strokeStyle = 'rgba(0,0,0,0.6)';
      cx.lineWidth = 2;
      cx.strokeRect(x + 1, 1, single - 2, single - 2);
      cx.fillStyle = 'rgba(0,0,0,0.7)';
      cx.font = `${Math.floor(single / 2.4)}px monospace`;
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillText(name[0].toUpperCase(), x + single / 2, single / 2);
    }
    return c;
  }

  // The drawable for a slot: the real image once loaded, placeholder otherwise.
  art(name) {
    const s = this.sprites[name];
    return (s.img.complete && s.img.naturalWidth > 0) ? s.img : s.placeholder;
  }

  resize() {
    this.w = this.canvas.width = window.innerWidth;
    this.h = this.canvas.height = window.innerHeight;
    this.fog.width = this.w; this.fog.height = this.h;
  }

  draw(game, input, now) {
    const ctx = this.ctx;
    const focus = game.focusPos(now);
    this.lastFocus = focus;
    const camX = focus.x - this.w / 2;
    const camY = focus.y - this.h / 2;
    const sx = (wx) => wx - camX;
    const sy = (wy) => wy - camY;

    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(0, 0, this.w, this.h);

    const x0 = Math.max(0, Math.floor(camX / TILE) - 1);
    const x1 = Math.min(game.map.cols, Math.ceil((camX + this.w) / TILE) + 1);
    const y0 = Math.max(0, Math.floor(camY / TILE) - 1);
    const y1 = Math.min(game.map.rows, Math.ceil((camY + this.h) / TILE) + 1);

    const floorArt = this.art('floor');
    const wallArt = this.art('wall');
    for (let ty = y0; ty < y1; ty++) {
      const row = game.map.tiles[ty];
      for (let tx = x0; tx < x1; tx++) {
        const art = row[tx] === '#' ? wallArt : floorArt;
        ctx.drawImage(art, 0, 0, TILE, TILE, Math.round(sx(tx * TILE)), Math.round(sy(ty * TILE)), TILE, TILE);
      }
    }

    this.drawObjectives(game, sx, sy);
    this.drawExit(game, sx, sy);
    this.drawMedkits(game, sx, sy);
    this.drawPlayers(game, input, now, sx, sy);
    this.drawCrates(game, sx, sy);
    if (game.role === 'killer') this.drawNoises(game, sx, sy, now);
    this.drawFog(game.fogMode(), input.aim);
    ctx.drawImage(this.fog, 0, 0);
    this.drawPanic(game);
    this.drawExitIndicator(game);
  }

  // Survivor panic: a red vignette that creeps in from the screen edges as the
  // killer closes distance, pulsing faster the closer he is.
  drawPanic(game) {
    if (game.role !== 'survivor' || game.localState !== 'up' || !game.curr) return;
    let killer = null;
    for (const [id, role] of game.roles) {
      if (role === 'killer') { killer = game.curr.players.get(id); break; }
    }
    if (!killer) return;
    const self = game.selfPos();
    const d = Math.hypot(self.x - killer.x, self.y - killer.y);
    const intensity = Math.max(0, 1 - d / PANIC_RANGE);
    if (intensity <= 0.02) return;

    const ctx = this.ctx;
    // Pulse speeds up as the killer closes: ~1.3Hz far away, ~3.5Hz on top of you.
    const hz = 1.3 + 2.2 * intensity;
    const pulse = 0.78 + 0.22 * Math.sin(performance.now() / 1000 * hz * Math.PI * 2);
    const alpha = (0.18 + 0.55 * intensity) * pulse;

    const cx = this.w / 2, cy = this.h / 2;
    // Inner edge pulls in as the killer closes, so the red squeezes the view.
    const minDim = Math.min(this.w, this.h);
    const inner = minDim * (0.30 - 0.20 * intensity);
    const outer = minDim * 0.50;
    const g = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    g.addColorStop(0, 'rgba(150,8,8,0)');
    g.addColorStop(1, `rgba(150,8,8,${alpha})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  drawObjectives(game, sx, sy) {
    const ctx = this.ctx;
    const r = game.config.objectiveRadius;
    const target = game.actionTarget();
    const genArt = this.art('generator');
    const GEN = SPRITES.generator.size;
    // Frame count auto-detected from sheet width: any number of 64px frames.
    const frames = Math.max(1, Math.floor(genArt.width / GEN));

    for (const o of game.objectives) {
      const ox = sx(o.x), oy = sy(o.y);

      // Animation frame follows repair progress; the last frame is "finished".
      const idx = o.done
        ? frames - 1
        : Math.min(frames - 1, Math.floor(o.progress * frames));
      ctx.drawImage(genArt, idx * GEN, 0, GEN, GEN, Math.round(ox - GEN / 2), Math.round(oy - GEN / 2), GEN, GEN);

      // The animated sprite shows progress now, so no ring/arc here. Just the
      // interact prompt when a survivor is standing in range.
      if (!o.done && target && target.kind === 'repair' && target.x === o.x && target.y === o.y) {
        this.prompt(ox, oy - r - 8, 'HOLD SPACE');
      }
    }
  }

  drawExit(game, sx, sy) {
    if (!game.exit) return;
    const ctx = this.ctx;
    const ex = sx(game.exit.x), ey = sy(game.exit.y);
    const r = game.config.exitRadius;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);

    if (game.exit.open) {
      // Breach is open: big inviting glow at the gap.
      ctx.fillStyle = `rgba(67,184,95,${0.18 + 0.18 * pulse})`;
      ctx.beginPath(); ctx.arc(ex, ey, r + 22, 0, Math.PI * 2); ctx.fill();
      return;
    }

    // Button still charging.
    ctx.fillStyle = `rgba(67,184,95,${0.08 + 0.10 * pulse})`;
    ctx.beginPath(); ctx.arc(ex, ey, r + 6, 0, Math.PI * 2); ctx.fill();

    ctx.drawImage(this.art('exit'), 0, 0, TILE, TILE, Math.round(ex - TILE / 2), Math.round(ey - TILE / 2), TILE, TILE);

    ctx.strokeStyle = COLORS.ringTrack; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ex, ey, r, 0, Math.PI * 2); ctx.stroke();
    if (game.exit.charge > 0) {
      ctx.strokeStyle = '#a0ffb0'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(ex, ey, r, -Math.PI / 2, -Math.PI / 2 + game.exit.charge * Math.PI * 2); ctx.stroke();
    }

    const target = game.actionTarget();
    if (target && target.kind === 'escape') this.prompt(ex, ey - r - 8, 'HOLD SPACE TO LOAD');
  }

  // A soft glow pinned to the edge of the view, pointing toward the exit when
  // it is off screen. Shown to everyone once the exit exists.
  drawExitIndicator(game) {
    if (!game.exit) return;
    const ctx = this.ctx;
    const focus = this.lastFocus;
    const dx = game.exit.x - focus.x;
    const dy = game.exit.y - focus.y;
    const margin = 46;
    const halfW = this.w / 2 - margin;
    const halfH = this.h / 2 - margin;
    if (Math.abs(dx) <= halfW && Math.abs(dy) <= halfH) return;  // on screen

    // Clamp the direction vector to the view rectangle edge.
    const scale = Math.min(halfW / Math.abs(dx || 1e-6), halfH / Math.abs(dy || 1e-6));
    const ix = this.w / 2 + dx * scale;
    const iy = this.h / 2 + dy * scale;

    const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 250);
    const g = ctx.createRadialGradient(ix, iy, 0, ix, iy, 30);
    g.addColorStop(0, `rgba(120,255,150,${0.7 * pulse})`);
    g.addColorStop(1, 'rgba(120,255,150,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(ix, iy, 30, 0, Math.PI * 2); ctx.fill();
  }

  drawPlayers(game, input, now, sx, sy) {
    const ctx = this.ctx;
    const maxHp = game.config.survivorHp;
    const target = game.actionTarget();

    for (const p of game.renderPlayers(now)) {
      const px = sx(p.x), py = sy(p.y);
      const isKiller = p.role === 'killer';
      const facing = p.self ? input.aim : (p.aim || 0);
      const dir = facingDir(facing);

      if (p.state === 'dead') {
        ctx.strokeStyle = COLORS.dead; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px - 7, py - 7); ctx.lineTo(px + 7, py + 7);
        ctx.moveTo(px + 7, py - 7); ctx.lineTo(px - 7, py + 7);
        ctx.stroke();
        continue;
      }

      if (isKiller) {
        // Menace aura: a big pulsing red glow under the sprite. Drawn below the
        // fog so it only shows where the viewer can actually see the killer.
        const auraR = game.config.killerRadius * KILLER_GLOW_SCALE;
        const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 200);
        const aura = ctx.createRadialGradient(px, py, 0, px, py, auraR);
        aura.addColorStop(0, `rgba(235,30,25,${0.6 * pulse})`);
        aura.addColorStop(0.45, `rgba(215,25,20,${0.32 * pulse})`);
        aura.addColorStop(1, 'rgba(215,25,20,0)');
        ctx.fillStyle = aura;
        ctx.beginPath(); ctx.arc(px, py, auraR, 0, Math.PI * 2); ctx.fill();

        if (p.swing) {
          const reach = game.config.attackRange + game.config.survivorRadius;
          ctx.fillStyle = 'rgba(255,150,140,0.35)';
          ctx.beginPath(); ctx.moveTo(px, py);
          ctx.arc(px, py, reach, facing - SWING_ARC, facing + SWING_ARC);
          ctx.closePath(); ctx.fill();
        }
        const K = SPRITES.killer.frame;
        this.drawFrame('killer', frameFor(dir) * K, K, px, py, null, 0);
        continue;
      }

      // survivor
      const S = SPRITES.survivor.frame;
      const frac = maxHp ? Math.max(0, p.hp ?? maxHp) / maxHp : 1;

      if (p.state === 'downed') {
        // dimmed body + bleed-out ring + revive arc
        this.ctx.globalAlpha = 0.55;
        this.drawFrame('survivor', frameFor('down') * S, S, px, py, '#d23a3a', 0.4);
        this.ctx.globalAlpha = 1;
        if (typeof p.bleed === 'number') {
          ctx.strokeStyle = 'rgba(210,58,58,0.8)'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(px, py, S / 2 + 6, -Math.PI / 2, -Math.PI / 2 + p.bleed * Math.PI * 2); ctx.stroke();
        }
        if (typeof p.revive === 'number' && p.revive > 0) {
          ctx.strokeStyle = '#a0ffb0'; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(px, py, S / 2 + 10, -Math.PI / 2, -Math.PI / 2 + p.revive * Math.PI * 2); ctx.stroke();
        }
        if (target && target.kind === 'revive' && target.x === p.x && target.y === p.y) {
          this.prompt(px, py - S / 2 - 16, 'HOLD SPACE TO REVIVE');
        }
        continue;
      }

      const tint = frac >= 0.999 ? null : hpColor(frac);
      const tintAlpha = (1 - frac) * 0.5;
      this.drawFrame('survivor', frameFor(dir) * S, S, px, py, tint, tintAlpha);
      if (p.self) this.selfRing(px, py, S / 2 + 3);
    }
  }

  drawCrates(game, sx, sy) {
    const crateArt = this.art('crate');
    const C = SPRITES.crate.size;
    for (const c of game.crates) {
      this.ctx.drawImage(crateArt, 0, 0, C, C, Math.round(sx(c.x) - C / 2), Math.round(sy(c.y) - C / 2), C, C);
    }
  }

  drawMedkits(game, sx, sy) {
    const art = this.art('medkit');
    const M = SPRITES.medkit.size;
    for (const m of game.medkits) {
      this.ctx.drawImage(art, 0, 0, M, M, Math.round(sx(m.x) - M / 2), Math.round(sy(m.y) - M / 2), M, M);
    }
  }

  // Expanding, fading rings where the killer heard something.
  drawNoises(game, sx, sy, now) {
    const ctx = this.ctx;
    for (const n of game.noises) {
      const age = (now - n.at) / 1200;           // 0..1 over lifetime
      if (age >= 1) continue;
      const radius = 10 + age * 36;
      ctx.strokeStyle = `rgba(255,210,63,${0.85 * (1 - age)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sx(n.x), sy(n.y), radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  prompt(x, y, text) {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.prompt;
    ctx.font = '12px Bungee, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y);
    ctx.textAlign = 'left';
  }

  // Draw one frame from a character sheet via the scratch canvas (for tint).
  drawFrame(slot, frameX, size, cx, cy, tintColor, tintAlpha) {
    const sc = this.scratchCtx;
    const dx = Math.round(cx - size / 2);
    const dy = Math.round(cy - size / 2);
    sc.clearRect(0, 0, size, size);
    sc.globalCompositeOperation = 'source-over';
    sc.globalAlpha = 1;
    sc.drawImage(this.art(slot), frameX, 0, size, size, 0, 0, size, size);
    if (tintColor && tintAlpha > 0.01) {
      sc.globalCompositeOperation = 'source-atop';
      sc.fillStyle = tintColor;
      sc.globalAlpha = tintAlpha;
      sc.fillRect(0, 0, size, size);
      sc.globalAlpha = 1;
      sc.globalCompositeOperation = 'source-over';
    }
    this.ctx.drawImage(this.scratch, 0, 0, size, size, dx, dy, size, size);
  }

  selfRing(px, py, r) {
    const ctx = this.ctx;
    ctx.strokeStyle = COLORS.self;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(Math.round(px), Math.round(py), r, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawFog(mode, aim) {
    const f = this.fogCtx;
    const cx = this.w / 2, cy = this.h / 2;
    // Survivors get a lighter fog so they can make out more of the map; the
    // killer and spectators stay in near-total darkness.
    const isSurvivorView = mode === 'survivor' || mode === 'downed';
    const fillAlpha = isSurvivorView ? SURVIVOR_FOG_ALPHA : FOG_ALPHA;
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, this.w, this.h);
    f.fillStyle = `rgba(4,5,9,${fillAlpha})`;
    f.fillRect(0, 0, this.w, this.h);
    f.globalCompositeOperation = 'destination-out';
    if (mode === 'killer') {
      this.radialHole(f, cx, cy, KILLER_VIEW, [[0, 1], [0.5, 0.9], [0.85, 0.35], [1, 0]]);
    } else if (mode === 'spectate') {
      this.radialHole(f, cx, cy, SPECTATE_VIEW, [[0, 1], [0.7, 0.6], [1, 0]]);
    } else if (mode === 'downed') {
      this.radialHole(f, cx, cy, SELF_GLOW * 1.6, [[0, 0.95], [1, 0]]);
    } else {
      this.radialHole(f, cx, cy, SELF_GLOW, [[0, 0.92], [1, 0]]);
      f.save();
      f.beginPath(); f.moveTo(cx, cy);
      f.arc(cx, cy, FLASH_RANGE, aim - FLASH_HALF_ANGLE, aim + FLASH_HALF_ANGLE);
      f.closePath(); f.clip();
      this.radialHole(f, cx, cy, FLASH_RANGE, [[0, 1], [0.6, 0.7], [1, 0]]);
      f.restore();
    }
    f.globalCompositeOperation = 'source-over';
  }

  radialHole(f, cx, cy, radius, stops) {
    const g = f.createRadialGradient(cx, cy, 0, cx, cy, radius);
    for (const [at, a] of stops) g.addColorStop(at, `rgba(0,0,0,${a})`);
    f.fillStyle = g;
    f.fillRect(0, 0, this.w, this.h);
  }
}
