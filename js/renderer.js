import {
  KILLER_VIEW, FLASH_RANGE, FLASH_HALF_ANGLE, SELF_GLOW, SPECTATE_VIEW, FOG_ALPHA,
  COLORS, hpColor,
} from './constants.js';

const SWING_ARC = 0.7;

// Survivor sheet: 128x32, 4 frames left-to-right: down, right, up, left
// Diagonal movement directions use horizontal priority (down-right -> right, etc.)
const SURV_FRAME_X = { down: 0, right: 32, up: 64, left: 96 };
function survivorFrame(dir) {
  if (dir === 'down') return SURV_FRAME_X.down;
  if (dir === 'up') return SURV_FRAME_X.up;
  if (dir === 'right' || dir === 'down-right' || dir === 'up-right') return SURV_FRAME_X.right;
  return SURV_FRAME_X.left; // left, down-left, up-left
}
const SURV_SIZE = 32;

// Killer sheet: 96x96, 2x2 grid, 48x48 per frame
// [ right(col0,row0) ] [ up(col1,row0)   ]
// [ left(col0,row1)  ] [ down(col1,row1) ]
const KILL_GRID = { right: [0,0], up: [1,0], left: [0,1], down: [1,1] };
function killerFrame(dir) {
  if (dir === 'down' || dir === 'down-left' || dir === 'down-right') return KILL_GRID.down;
  if (dir === 'up' || dir === 'up-left' || dir === 'up-right') return KILL_GRID.up;
  if (dir === 'right') return KILL_GRID.right;
  return KILL_GRID.left;
}
const KILL_SIZE = 48;

function facingDir(aim) {
  const a = ((aim % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const eighth = Math.PI / 4;
  if (a < eighth / 2 || a >= 2 * Math.PI - eighth / 2) return 'right';
  if (a < eighth + eighth / 2) return 'down-right';
  if (a < 2 * eighth + eighth / 2) return 'down';
  if (a < 3 * eighth + eighth / 2) return 'down-left';
  if (a < 4 * eighth + eighth / 2) return 'left';
  if (a < 5 * eighth + eighth / 2) return 'up-left';
  if (a < 6 * eighth + eighth / 2) return 'up';
  if (a < 7 * eighth + eighth / 2) return 'up-right';
  return 'right';
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fog = document.createElement('canvas');
    this.fogCtx = this.fog.getContext('2d');
    // scratch canvas for hp-tinted sprite compositing
    this.scratch = document.createElement('canvas');
    this.scratch.width = 64; this.scratch.height = 64;
    this.scratchCtx = this.scratch.getContext('2d');

    this.imgs = {
      floor: this.loadImg('sprites/floor.png'),
      wall: this.loadImg('sprites/wall.png'),
      killer: this.loadImg('sprites/killer.png'),
      survivor: this.loadImg('sprites/survivor.png'),
    };
    // Background-removed versions of the character sheets (floor/wall stay solid).
    this.keyed = { killer: null, survivor: null };
    const keyWhenReady = (name) => {
      const img = this.imgs[name];
      const run = () => { this.keyed[name] = this.removeBackground(img); };
      if (img.complete && img.naturalWidth > 0) run();
      else img.addEventListener('load', run);
    };
    keyWhenReady('killer');
    keyWhenReady('survivor');

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  loadImg(src) { const i = new Image(); i.src = src; return i; }
  ready(img) { return img && (img.complete ? img.naturalWidth > 0 : img.width > 0); }

  // Make the sprite background transparent. Flood-fills from the edges keying
  // out pixels close to the corner colour, so interior dark pixels (eyes,
  // outlines) are kept. If the sheet already has alpha, it is left untouched.
  removeBackground(img) {
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    const data = cx.getImageData(0, 0, W, H);
    const px = data.data;
    if (px[3] === 0) return c; // already transparent

    const br = px[0], bg = px[1], bb = px[2];
    const tol = 42;
    const isBg = (i) => Math.abs(px[i] - br) < tol && Math.abs(px[i + 1] - bg) < tol && Math.abs(px[i + 2] - bb) < tol;

    const visited = new Uint8Array(W * H);
    const stack = [];
    for (let x = 0; x < W; x++) { stack.push(x, 0, x, H - 1); }
    for (let y = 0; y < H; y++) { stack.push(0, y, W - 1, y); }
    while (stack.length) {
      const y = stack.pop(), x = stack.pop();
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const idx = y * W + x;
      if (visited[idx]) continue;
      visited[idx] = 1;
      const i = idx * 4;
      if (!isBg(i)) continue;
      px[i + 3] = 0;
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    cx.putImageData(data, 0, 0);
    return c;
  }

  resize() {
    this.w = this.canvas.width = window.innerWidth;
    this.h = this.canvas.height = window.innerHeight;
    this.fog.width = this.w; this.fog.height = this.h;
  }

  draw(game, input, now) {
    const ctx = this.ctx;
    const TILE = 32;
    const focus = game.focusPos(now);
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

    // floor tiles
    for (let ty = y0; ty < y1; ty++) {
      const row = game.map.tiles[ty];
      for (let tx = x0; tx < x1; tx++) {
        if (row[tx] !== '#') {
          if (this.ready(this.imgs.floor)) {
            ctx.drawImage(this.imgs.floor, sx(tx * TILE), sy(ty * TILE), TILE, TILE);
          } else {
            ctx.fillStyle = COLORS.floor;
            ctx.fillRect(sx(tx * TILE), sy(ty * TILE), TILE, TILE);
          }
        }
      }
    }


    // walls
    ctx.fillStyle = COLORS.wall;
    for (let ty = y0; ty < y1; ty++) {
      const row = game.map.tiles[ty];
      for (let tx = x0; tx < x1; tx++) {
        if (row[tx] === '#') {
          if (this.ready(this.imgs.wall)) {
            ctx.drawImage(this.imgs.wall, Math.round(sx(tx * TILE)), Math.round(sy(ty * TILE)), TILE, TILE);
          } else {
            ctx.fillRect(sx(tx * TILE), sy(ty * TILE), TILE, TILE);
          }
        }
      }
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
      if (o.progress > 0) {
        ctx.fillStyle = 'rgba(255,210,63,0.18)';
        ctx.beginPath(); ctx.moveTo(ox, oy);
        ctx.arc(ox, oy, r - 3, -Math.PI / 2, -Math.PI / 2 + o.progress * Math.PI * 2);
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = COLORS.ringTrack; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.stroke();
      if (o.progress > 0) {
        ctx.strokeStyle = COLORS.ring; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(ox, oy, r, -Math.PI / 2, -Math.PI / 2 + o.progress * Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = COLORS.objective;
      ctx.beginPath(); ctx.arc(ox, oy, 7, 0, Math.PI * 2); ctx.fill();

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
      const isKiller = p.role === 'killer';
      const facing = (p.self && isKiller) ? input.aim
        : (p.self && !isKiller) ? input.aim
        : (p.aim || 0);
      const dir = facingDir(facing);

      if (!p.alive) {
        // downed marker
        ctx.strokeStyle = COLORS.dead; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(px - 7, py - 7); ctx.lineTo(px + 7, py + 7);
        ctx.moveTo(px + 7, py - 7); ctx.lineTo(px - 7, py + 7);
        ctx.stroke();
        continue;
      }

      if (isKiller) {
        if (p.swing) {
          const reach = game.config.attackRange + game.config.survivorRadius;
          ctx.fillStyle = 'rgba(255,150,140,0.35)';
          ctx.beginPath(); ctx.moveTo(px, py);
          ctx.arc(px, py, reach, facing - SWING_ARC, facing + SWING_ARC);
          ctx.closePath(); ctx.fill();
        }
        if (this.keyed.killer) {
          const [col, row] = killerFrame(dir);
          this.drawSprite(this.keyed.killer, col * KILL_SIZE, row * KILL_SIZE, KILL_SIZE, KILL_SIZE, px, py, null, 0);
        } else {
          ctx.fillStyle = COLORS.killer;
          ctx.beginPath(); ctx.arc(px, py, game.config.killerRadius, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = COLORS.killer; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(px, py);
          ctx.lineTo(px + Math.cos(facing) * (game.config.killerRadius + 10), py + Math.sin(facing) * (game.config.killerRadius + 10));
          ctx.stroke();
        }
        continue;
      }

      // survivor
      const frac = maxHp ? Math.max(0, p.hp ?? maxHp) / maxHp : 1;
      const tint = frac >= 0.999 ? null : hpColor(frac);
      const tintAlpha = (1 - frac) * 0.5;

      if (this.keyed.survivor) {
        const frameX = survivorFrame(dir);
        this.drawSprite(this.keyed.survivor, frameX, 0, SURV_SIZE, SURV_SIZE, px, py, tint, tintAlpha);
        if (p.self) this.selfRing(px, py, SURV_SIZE / 2 + 3);
      } else {
        ctx.fillStyle = p.self ? COLORS.self : (tint || '#4ea3ff');
        ctx.beginPath(); ctx.arc(px, py, game.config.survivorRadius, 0, Math.PI * 2); ctx.fill();
        if (p.self) this.selfRing(px, py, game.config.survivorRadius + 3);
      }
    }
  }

  // Draw a sprite frame to an offscreen scratch canvas, apply hp tint via
  // source-atop compositing, then blit to the main canvas. Requires the
  // sprite PNG to have a transparent background (standard Piskel export).
  drawSprite(img, sx, sy, sw, sh, cx, cy, tintColor, tintAlpha) {
    const sc = this.scratchCtx;
    const dx = Math.round(cx - sw / 2);
    const dy = Math.round(cy - sh / 2);
    sc.clearRect(0, 0, sw, sh);
    sc.globalCompositeOperation = 'source-over';
    sc.globalAlpha = 1;
    sc.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    if (tintColor && tintAlpha > 0.01) {
      sc.globalCompositeOperation = 'source-atop';
      sc.fillStyle = tintColor;
      sc.globalAlpha = tintAlpha;
      sc.fillRect(0, 0, sw, sh);
      sc.globalAlpha = 1;
      sc.globalCompositeOperation = 'source-over';
    }
    this.ctx.drawImage(this.scratch, 0, 0, sw, sh, dx, dy, sw, sh);
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
