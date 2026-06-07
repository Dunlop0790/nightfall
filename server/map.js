// Map construction. Built procedurally but deterministically so dimensions are
// always correct. Bigger and less symmetric than the first pass: rooms of mixed
// sizes, L-shaped cover, scattered pillars, and open "anchor" tiles used for
// clustered spawns. Objective spots are sampled fresh each round.

import { TILE, OBJECTIVES_TO_WIN } from './constants.js';

const COLS = 45;
const ROWS = 29;

function blankGrid() {
  const g = [];
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) {
      const border = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
      row.push(border ? '#' : '.');
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
function open(g, x, y) { g[y][x] = '.'; }

function buildGrid() {
  const g = blankGrid();

  // Rooms of varied sizes scattered without mirror symmetry. Each gets two-tile
  // doors so the killer (radius 15, box 30px) fits through comfortably.
  roomOutline(g, 3, 3, 9, 6);    open(g, 11, 5); open(g, 11, 6); open(g, 6, 8); open(g, 7, 8);
  roomOutline(g, 16, 2, 7, 8);   open(g, 16, 5); open(g, 16, 6); open(g, 19, 9); open(g, 20, 9);
  roomOutline(g, 30, 3, 11, 5);  open(g, 30, 5); open(g, 30, 6); open(g, 36, 7); open(g, 37, 7);
  roomOutline(g, 4, 13, 8, 9);   open(g, 11, 17); open(g, 11, 18); open(g, 7, 21); open(g, 8, 21);
  roomOutline(g, 33, 11, 8, 7);  open(g, 33, 14); open(g, 33, 15); open(g, 37, 17); open(g, 38, 17);
  roomOutline(g, 25, 14, 7, 6);  open(g, 28, 14); open(g, 29, 14); open(g, 25, 17); open(g, 25, 18);
  roomOutline(g, 15, 20, 10, 7); open(g, 19, 20); open(g, 20, 20); open(g, 24, 23); open(g, 24, 24);
  roomOutline(g, 30, 21, 11, 6); open(g, 35, 21); open(g, 36, 21); open(g, 30, 24); open(g, 30, 25);

  // L-shaped cover and loose segments to break long sightlines.
  hWall(g, 14, 12, 6); vWall(g, 14, 12, 4);
  hWall(g, 25, 9, 5);
  vWall(g, 22, 13, 5);
  hWall(g, 6, 24, 5);
  hWall(g, 43 - 8, 9, 5);
  vWall(g, 12, 24, 3);
  hWall(g, 26, 25, 4);

  // Single-tile pillars for cover in the open lanes.
  const pillars = [
    [20, 6], [38, 10], [9, 11], [27, 4], [41, 13],
    [13, 16], [21, 16], [35, 9], [18, 25], [29, 12],
    [6, 18], [42, 22],
  ];
  for (const [px, py] of pillars) g[py][px] = '#';

  return g;
}

function center(tx, ty) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

function isOpen3x3(grid, x, y) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (grid[y + dy][x + dx] === '#') return false;
    }
  }
  return true;
}

// Spread-out open tiles used as spawn cluster anchors.
function spawnAnchors(grid) {
  const out = [];
  for (let y = 3; y < ROWS - 3; y += 4) {
    for (let x = 3; x < COLS - 3; x += 4) {
      if (isOpen3x3(grid, x, y)) out.push({ x, y });
    }
  }
  return out;
}

function chebyshev(a, b) { return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)); }

function objectiveCandidates(grid) {
  const out = [];
  for (let y = 2; y < ROWS - 2; y++) {
    for (let x = 2; x < COLS - 2; x++) {
      if (grid[y][x] !== '.') continue;
      const wallNeighbor =
        grid[y - 1][x] === '#' || grid[y + 1][x] === '#' ||
        grid[y][x - 1] === '#' || grid[y][x + 1] === '#';
      if (wallNeighbor) continue;
      out.push({ x, y });
    }
  }
  return out;
}

export function buildMap() {
  const grid = buildGrid();
  const anchors = spawnAnchors(grid);
  if (anchors.length < 2) throw new Error('Map has too few open spawn anchors');

  const candidates = objectiveCandidates(grid);
  if (candidates.length < OBJECTIVES_TO_WIN) {
    throw new Error('Map has too few objective candidate tiles');
  }

  const tiles = grid.map(row => row.join(''));

  return {
    cols: COLS,
    rows: ROWS,
    grid,
    tiles,
    anchors,                // tile coords, open 3x3 areas
    objectiveCandidates: candidates,
  };
}

// Pick survivor + killer spawn anchors. Survivors cluster on one anchor; the
// killer takes the anchor farthest from them so the round never opens with the
// killer on top of the group.
export function pickSpawns(map) {
  const a = map.anchors;
  const survivor = a[Math.floor(Math.random() * a.length)];
  let killer = a[0];
  let best = -1;
  for (const c of a) {
    const d = chebyshev(c, survivor);
    if (d > best) { best = d; killer = c; }
  }
  return {
    survivorAnchor: center(survivor.x, survivor.y),
    killerAnchor: center(killer.x, killer.y),
  };
}

export function sampleObjectives(map, n) {
  const pool = [...map.objectiveCandidates];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const chosen = [];
  for (const tile of pool) {
    if (chosen.length >= n) break;
    if (chosen.every(c => chebyshev(c, tile) >= 6)) chosen.push(tile);
  }
  for (const tile of pool) {
    if (chosen.length >= n) break;
    if (!chosen.includes(tile)) chosen.push(tile);
  }
  return chosen.map(t => center(t.x, t.y));
}
