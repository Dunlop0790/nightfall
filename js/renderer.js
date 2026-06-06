// Draws the world, then a fog overlay with a soft gradient hole for what the
// focused player can see. Killer: wide circle fogging out with distance.
// Survivor: flashlight cone plus a small body glow. Spectator (downed): a
// neutral circle around whoever is being watched.

import {
  KILLER_VIEW, FLASH_RANGE, FLASH_HALF_ANGLE, SELF_GLOW, SPECTATE_VIEW, FOG_ALPHA,
  COLORS, hpColor,
} from './constants.js';

const SWING_RADIUS = 46;
const SWING_ARC = 0.7;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fog = document.createElement('canvas');
    this.fogCtx = this.fog.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.w = this.canvas.width = window.innerWidth;
    this.h = this.canvas.height = window.innerHeight;
    this.fog.width = this.w;
    this.fog.height = this.h;
  }

  draw(game, input, now) {
    const ctx = this.ctx;
    const tile = 32;
    const focus = game.focusPos(now);
    const camX = focus.x - this.w / 2;
    const camY = focus.y - this.h / 2;
    const sx = (wx) => wx - camX;
    const sy = (wy) => wy - camY;

    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(0, 0, this.w, this.h);

    const x0 = Math.max(0, Math.floor(camX / tile) - 1);
    const x1 = Math.min(game.map.cols, Math.ceil((camX + this.w) / tile) + 1);
    const y0 = Math.max(0, Math.floor(camY / tile) - 1);
    const y1 = Math.min(game.map.rows, Math.ceil((camY + this.h) / tile) + 1);

    // grid
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let tx = x0; tx <= x1; tx++) { ctx.moveTo(sx(tx * tile), sy(y0 * tile)); ctx.lineTo(sx(tx * tile), sy(y1 * tile)); }
    for (let ty = y0; ty <= y1; ty++) { ctx.moveTo(sx(x0 * tile), sy(ty * tile)); ctx.lineTo(sx(x1 * tile), sy(ty * tile)); }
    ctx.stroke();

    // walls
    ctx.fillStyle = COLORS.wall;
    for (let ty = y0; ty < y1; ty++) {
      const row = game.map.tiles[ty];
      for (let tx = x0; tx < x1; tx++) if (row[tx] === '#') ctx.fillRect(sx(tx * tile), sy(ty * tile), tile, tile);
    }

    this.drawObjectives(game, sx, sy);
    this.drawPlayers(game, input, now, sx, sy);
    this.drawFog(game.fogMode(), input.aim);
    ctx.drawImage(this.fog, 0, 0);
  }

  drawObjectives(game, sx, sy) {
    const ctx = this.ctx;
    const r = game.config.objectiveRadius;
    const inRange = game.objectiveInRange();
    for (const o of game.objectives) {
      const ox = sx(o.x), oy = sy(o.y);
      if (o.done) {
        ctx.fillStyle = COLORS.objectiveDone;
        ctx.beginPath(); ctx.arc(ox, oy, 10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = COLORS.objectiveDone; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.stroke();
        continue;
      }
      // filled progress disc
      if (o.progress > 0) {
        ctx.fillStyle = 'rgba(255,210,63,0.18)';
        ctx.beginPath(); ctx.moveTo(ox, oy);
        ctx.arc(ox, oy, r - 3, -Math.PI / 2, -Math.PI / 2 + o.progress * Math.PI * 2);
        ctx.closePath(); ctx.fill();
      }
      // range ring + progress arc
      ctx.strokeStyle = COLORS.ringTrack; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.stroke();
      if (o.progress > 0) {
        ctx.strokeStyle = COLORS.ring; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(ox, oy, r, -Math.PI / 2, -Math.PI / 2 + o.progress * Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = COLORS.objective;
      ctx.beginPath(); ctx.arc(ox, oy, 7, 0, Math.PI * 2); ctx.fill();

      // prompt when the local survivor is standing in it
      if (o === inRange) {
        ctx.fillStyle = COLORS.prompt;
        ctx.font = '12px Bungee, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('HOLD SPACE', ox, oy - r - 8);
        ctx.textAlign = 'left';
      }
    }
  }

  drawPlayers(game, input, now, sx, sy) {
    const ctx = this.ctx;
    const maxHp = game.config.survivorHp;
    for (const p of game.renderPlayers(now)) {
      const px = sx(p.x), py = sy(p.y);
      const radius = p.role === 'killer' ? game.config.killerRadius : game.config.survivorRadius;
      const facing = p.self && game.role === 'killer' ? input.aim : (p.aim || 0);

      if (p.role === 'survivor' && !p.alive) {
        ctx.strokeStyle = COLORS.dead; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px - 7, py - 7); ctx.lineTo(px + 7, py + 7);
        ctx.moveTo(px + 7, py - 7); ctx.lineTo(px - 7, py + 7);
        ctx.stroke();
        continue;
      }

      if (p.role === 'killer') {
        // lunge trail behind the facing direction
        if (p.lunging) {
          for (let i = 1; i <= 3; i++) {
            ctx.fillStyle = `rgba(210,72,61,${0.18 / i})`;
            ctx.beginPath();
            ctx.arc(px - Math.cos(facing) * i * 12, py - Math.sin(facing) * i * 12, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.fillStyle = COLORS.killer;
        ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill();
        // facing tick
        ctx.strokeStyle = COLORS.killer; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(facing) * (radius + 10), py + Math.sin(facing) * (radius + 10));
        ctx.stroke();
        // swing arc flash
        if (p.swing) {
          ctx.fillStyle = 'rgba(255,150,140,0.35)';
          ctx.beginPath(); ctx.moveTo(px, py);
          ctx.arc(px, py, SWING_RADIUS, facing - SWING_ARC, facing + SWING_ARC);
          ctx.closePath(); ctx.fill();
        }
        continue;
      }

      // survivor
      const frac = maxHp ? Math.max(0, p.hp) / maxHp : 1;
      ctx.fillStyle = p.self ? COLORS.self : hpColor(frac);
      ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.fill();
      if (p.self) {
        ctx.strokeStyle = COLORS.self; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, radius + 3, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  drawFog(mode, aim) {
    const f = this.fogCtx;
    const cx = this.w / 2, cy = this.h / 2;

    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, this.w, this.h);
    f.fillStyle = `rgba(4,5,9,${FOG_ALPHA})`;
    f.fillRect(0, 0, this.w, this.h);
    f.globalCompositeOperation = 'destination-out';

    if (mode === 'killer') {
      this.radialHole(f, cx, cy, KILLER_VIEW, [[0, 1], [0.5, 0.9], [0.85, 0.35], [1, 0]]);
    } else if (mode === 'spectate') {
      this.radialHole(f, cx, cy, SPECTATE_VIEW, [[0, 1], [0.7, 0.6], [1, 0]]);
    } else {
      // survivor: body glow + flashlight cone
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
