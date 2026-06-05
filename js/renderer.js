// Draws the world, then lays a fog overlay on top with a hole cut out for what
// the local player can see. The cut-out is a soft gradient (foggier with
// distance) rather than a hard edge: a wide circle for the killer, a flashlight
// cone plus a small body-glow for survivors. Walls do not cast shadows; vision
// is purely the gradient, which is the look we want.

import {
  KILLER_VIEW, FLASH_RANGE, FLASH_HALF_ANGLE, SELF_GLOW, FOG_ALPHA, COLORS,
} from './constants.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fog = document.createElement('canvas');
    this.fogCtx = this.fog.getContext('2d');
    this.w = 0; this.h = 0;
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
    const tile = game.config.tile;
    const self = game.selfPos();
    const camX = self.x - this.w / 2;
    const camY = self.y - this.h / 2;
    const toScreenX = (wx) => wx - camX;
    const toScreenY = (wy) => wy - camY;

    // floor
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(0, 0, this.w, this.h);

    // visible tile range
    const x0 = Math.max(0, Math.floor(camX / tile) - 1);
    const x1 = Math.min(game.map.cols, Math.ceil((camX + this.w) / tile) + 1);
    const y0 = Math.max(0, Math.floor(camY / tile) - 1);
    const y1 = Math.min(game.map.rows, Math.ceil((camY + this.h) / tile) + 1);

    // grid
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let tx = x0; tx <= x1; tx++) {
      const sx = toScreenX(tx * tile);
      ctx.moveTo(sx, toScreenY(y0 * tile)); ctx.lineTo(sx, toScreenY(y1 * tile));
    }
    for (let ty = y0; ty <= y1; ty++) {
      const sy = toScreenY(ty * tile);
      ctx.moveTo(toScreenX(x0 * tile), sy); ctx.lineTo(toScreenX(x1 * tile), sy);
    }
    ctx.stroke();

    // walls
    ctx.fillStyle = COLORS.wall;
    for (let ty = y0; ty < y1; ty++) {
      const row = game.map.tiles[ty];
      for (let tx = x0; tx < x1; tx++) {
        if (row[tx] === '#') {
          ctx.fillRect(toScreenX(tx * tile), toScreenY(ty * tile), tile, tile);
        }
      }
    }

    // objectives
    for (const o of game.objectives) {
      const ox = toScreenX(o.x); const oy = toScreenY(o.y);
      const r = game.config.objectiveRadius;
      if (o.done) {
        ctx.fillStyle = COLORS.objectiveDone;
        ctx.beginPath(); ctx.arc(ox, oy, 10, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = COLORS.objectiveDone; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.stroke();
      } else {
        // range ring track
        ctx.strokeStyle = COLORS.ringTrack; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.stroke();
        // progress arc
        if (o.progress > 0) {
          ctx.strokeStyle = COLORS.ring; ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(ox, oy, r, -Math.PI / 2, -Math.PI / 2 + o.progress * Math.PI * 2);
          ctx.stroke();
        }
        // core
        ctx.fillStyle = COLORS.objective;
        ctx.beginPath(); ctx.arc(ox, oy, 7, 0, Math.PI * 2); ctx.fill();
      }
    }

    // players
    const pr = game.config.playerRadius;
    for (const p of game.renderPlayers(now)) {
      const px = toScreenX(p.x); const py = toScreenY(p.y);
      if (p.role === 'survivor' && !p.alive) {
        // downed survivor marker
        ctx.strokeStyle = COLORS.dead; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px - 7, py - 7); ctx.lineTo(px + 7, py + 7);
        ctx.moveTo(px + 7, py - 7); ctx.lineTo(px - 7, py + 7);
        ctx.stroke();
        continue;
      }
      let color = p.role === 'killer' ? COLORS.killer : COLORS.survivor;
      if (p.self) color = COLORS.self;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
      // facing tick for the local player
      if (p.self) {
        ctx.strokeStyle = color; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(input.aim) * (pr + 8), py + Math.sin(input.aim) * (pr + 8));
        ctx.stroke();
      }
    }

    // fog / vision
    const survivorDead = game.role === 'survivor' && !game.localAlive;
    if (survivorDead) {
      // spectator: no fog, just a ghostly dim
      ctx.fillStyle = 'rgba(3,4,8,0.55)';
      ctx.fillRect(0, 0, this.w, this.h);
    } else {
      this.drawFog(game.role, input.aim);
      ctx.drawImage(this.fog, 0, 0);
    }
  }

  drawFog(role, aim) {
    const f = this.fogCtx;
    const cx = this.w / 2; const cy = this.h / 2;

    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, this.w, this.h);
    f.fillStyle = `rgba(4,5,9,${FOG_ALPHA})`;
    f.fillRect(0, 0, this.w, this.h);

    f.globalCompositeOperation = 'destination-out';

    if (role === 'killer') {
      const g = f.createRadialGradient(cx, cy, 0, cx, cy, KILLER_VIEW);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.9)');
      g.addColorStop(0.85, 'rgba(0,0,0,0.35)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = g;
      f.fillRect(0, 0, this.w, this.h);
    } else {
      // body glow so the survivor is never fully blind around themselves
      const glow = f.createRadialGradient(cx, cy, 0, cx, cy, SELF_GLOW);
      glow.addColorStop(0, 'rgba(0,0,0,0.92)');
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = glow;
      f.fillRect(0, 0, this.w, this.h);

      // flashlight cone
      f.save();
      f.beginPath();
      f.moveTo(cx, cy);
      f.arc(cx, cy, FLASH_RANGE, aim - FLASH_HALF_ANGLE, aim + FLASH_HALF_ANGLE);
      f.closePath();
      f.clip();
      const cone = f.createRadialGradient(cx, cy, 0, cx, cy, FLASH_RANGE);
      cone.addColorStop(0, 'rgba(0,0,0,1)');
      cone.addColorStop(0.6, 'rgba(0,0,0,0.7)');
      cone.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = cone;
      f.fillRect(0, 0, this.w, this.h);
      f.restore();
    }

    f.globalCompositeOperation = 'source-over';
  }
}
