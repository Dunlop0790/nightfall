import { TILE, OBJECTIVES_TO_WIN } from './constants.js';

const COLS = 65;
const ROWS = 41;

function blankGrid() {
  const g = [];
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) {
      row.push(x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? '#' : '.');
    }
    g.push(row);
  }
  return g;
}

function roomOutline(g, x, y, w, h) {
  for (let i = 0; i < w; i++) { g[y][x + i] = '#'; g[y + h - 1][x + i] = '#'; }
  for (let j = 0; j < h; j++) { g[y + j][x] = '#'; g[y + j][x + w - 1] = '#'; }
}
function hWall(g, x, y, len) { for (let i = 0; i < len; i++) g[y][x + i] = '#'; }
function vWall(g, x, y, len) { for (let j = 0; j < len; j++) g[y + j][x] = '#'; }
function open(g, x, y) { if (y >= 0 && y < ROWS && x >= 0 && x < COLS) g[y][x] = '.'; }

function buildGrid() {
  const g = blankGrid();

  // All doors are 2 tiles wide so the killer fits through comfortably.
  // Top-left quadrant
  roomOutline(g, 3, 3, 9, 7);
    open(g,11,5); open(g,11,6); open(g,6,9); open(g,7,9);
  roomOutline(g, 16, 2, 8, 9);
    open(g,16,5); open(g,16,6); open(g,23,5); open(g,23,6); open(g,19,10); open(g,20,10);
  roomOutline(g, 3, 15, 7, 8);
    open(g,9,18); open(g,9,19); open(g,5,22); open(g,6,22);

  // Top-right quadrant
  roomOutline(g, 38, 3, 12, 6);
    open(g,38,5); open(g,38,6); open(g,44,8); open(g,45,8);
  roomOutline(g, 53, 3, 9, 8);
    open(g,53,5); open(g,53,6); open(g,57,10); open(g,58,10);
  roomOutline(g, 40, 12, 8, 7);
    open(g,47,14); open(g,47,15); open(g,43,18); open(g,44,18);

  // Centre block
  roomOutline(g, 27, 10, 12, 10);
    open(g,30,10); open(g,31,10); open(g,36,10); open(g,37,10);
    open(g,27,14); open(g,27,15); open(g,38,14); open(g,38,15);
    open(g,31,19); open(g,32,19);

  // Bottom-left quadrant
  roomOutline(g, 3, 27, 10, 8);
    open(g,12,30); open(g,12,31); open(g,6,34); open(g,7,34);
  roomOutline(g, 16, 25, 8, 7);
    open(g,16,27); open(g,16,28); open(g,19,31); open(g,20,31);
  roomOutline(g, 4, 36, 12, 4);
    open(g,7,36); open(g,8,36); open(g,15,37); open(g,15,38);

  // Bottom-right quadrant
  roomOutline(g, 45, 25, 9, 8);
    open(g,45,27); open(g,45,28); open(g,49,32); open(g,50,32);
  roomOutline(g, 52, 31, 10, 8);
    open(g,52,33); open(g,52,34); open(g,57,38); open(g,58,38);
  roomOutline(g, 36, 31, 8, 7);
    open(g,43,33); open(g,43,34); open(g,38,37); open(g,39,37);

  // L-shaped cover and loose segments
  hWall(g, 14, 13, 7); vWall(g, 14, 13, 5);
  hWall(g, 27, 6, 5);
  vWall(g, 25, 20, 6);
  hWall(g, 35, 24, 6);
  vWall(g, 50, 12, 5);
  hWall(g, 6, 24, 5);
  hWall(g, 55, 20, 5);
  vWall(g, 32, 27, 4);
  hWall(g, 15, 38, 5);
  hWall(g, 42, 8, 4);
  vWall(g, 62, 14, 5);
  hWall(g, 22, 34, 5);

  // Pillars
  const pillars = [
    [9,7],[23,11],[31,6],[48,6],[60,12],[37,6],
    [13,21],[21,21],[42,22],[56,24],[10,32],[26,28],
    [44,14],[20,38],[52,16],[35,37],[62,28],[8,17],
    [29,24],[47,30],[58,35],[15,31],[34,20],[51,37],
  ];
  for (const [px, py] of pillars) {
    if (py >= 0 && py < ROWS && px >= 0 && px < COLS) g[py][px] = '#';
  }

  return g;
}

function center(tx, ty) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

function isOpen3x3(grid, x, y) {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (grid[y + dy][x + dx] === '#') return false;
  return true;
}

function spawnAnchors(grid) {
  const out = [];
  for (let y = 4; y < ROWS - 4; y += 5)
    for (let x = 4; x < COLS - 4; x += 5)
      if (isOpen3x3(grid, x, y)) out.push({ x, y });
  return out;
}

function chebyshev(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }

function objectiveCandidates(grid) {
  const out = [];
  for (let y = 2; y < ROWS - 2; y++)
    for (let x = 2; x < COLS - 2; x++) {
      if (grid[y][x] !== '.') continue;
      if (grid[y-1][x]==='#'||grid[y+1][x]==='#'||grid[y][x-1]==='#'||grid[y][x+1]==='#') continue;
      out.push({ x, y });
    }
  return out;
}

export function buildMap() {
  const grid = buildGrid();
  const anchors = spawnAnchors(grid);
  if (anchors.length < 2) throw new Error('Map has too few open spawn anchors');
  const candidates = objectiveCandidates(grid);
  if (candidates.length < OBJECTIVES_TO_WIN) throw new Error('Map has too few objective candidate tiles');
  return { cols: COLS, rows: ROWS, grid, tiles: grid.map(r => r.join('')), anchors, objectiveCandidates: candidates };
}

export function pickSpawns(map) {
  const a = map.anchors;
  const survivor = a[Math.floor(Math.random() * a.length)];
  let killer = a[0]; let best = -1;
  for (const c of a) { const d = chebyshev(c, survivor); if (d > best) { best = d; killer = c; } }
  return { survivorAnchor: center(survivor.x, survivor.y), killerAnchor: center(killer.x, killer.y) };
}

export function sampleObjectives(map, n) {
  const pool = [...map.objectiveCandidates];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const chosen = [];
  for (const t of pool) { if (chosen.length >= n) break; if (chosen.every(c => chebyshev(c, t) >= 6)) chosen.push(t); }
  for (const t of pool) { if (chosen.length >= n) break; if (!chosen.includes(t)) chosen.push(t); }
  return chosen.map(t => center(t.x, t.y));
}

// Crates: non-solid hide props placed on floor tiles that touch at least one
// wall. Wall-adjacent tiles are exactly the ones excluded from generator
// candidates, so crates and generators never collide.
export function sampleCrates(map, n) {
  const g = map.grid;
  const pool = [];
  for (let y = 2; y < map.rows - 2; y++) {
    for (let x = 2; x < map.cols - 2; x++) {
      if (g[y][x] !== '.') continue;
      const wallNeighbor =
        g[y - 1][x] === '#' || g[y + 1][x] === '#' ||
        g[y][x - 1] === '#' || g[y][x + 1] === '#';
      if (wallNeighbor) pool.push({ x, y });
    }
  }
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const chosen = [];
  for (const t of pool) {
    if (chosen.length >= n) break;
    if (chosen.every(c => chebyshev(c, t) >= 3)) chosen.push(t);
  }
  return chosen.map(t => center(t.x, t.y));
}
