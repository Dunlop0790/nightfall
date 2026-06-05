// Map construction. The layout is built procedurally but deterministically so
// the grid dimensions are always correct (no hand-counting walls). Objective
// positions are sampled fresh each round so survivors can't memorize them.

import { TILE, OBJECTIVES_TO_WIN } from './constants.js';

const COLS = 31;
const ROWS = 19;

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

// Draw the outline of a rectangular room.
function room(g, x, y, w, h) {
  for (let i = 0; i < w; i++) { g[y][x + i] = '#'; g[y + h - 1][x + i] = '#'; }
  for (let j = 0; j < h; j++) { g[y + j][x] = '#'; g[y + j][x + w - 1] = '#'; }
}

function open(g, x, y) { g[y][x] = '.'; }

function buildGrid() {
  const g = blankGrid();

  // Central block (the heart of the map, several doorways).
  room(g, 12, 6, 8, 7);
  open(g, 14, 6); open(g, 17, 6);
  open(g, 12, 9); open(g, 19, 9);
  open(g, 15, 12); open(g, 16, 12);

  // Four corner rooms, each with a door punched out toward the open floor.
  room(g, 3, 3, 6, 5);  open(g, 8, 5);  open(g, 5, 7);
  room(g, 22, 3, 6, 5); open(g, 22, 5); open(g, 25, 7);
  room(g, 3, 11, 6, 5); open(g, 5, 11); open(g, 8, 13);
  room(g, 22, 11, 6, 5); open(g, 25, 11); open(g, 22, 13);

  // Loose cover walls to create chase loops in the open lanes. Kept clear of
  // spawns and doorways.
  g[4][13] = '#'; g[4][14] = '#'; g[4][16] = '#'; g[4][17] = '#';
  g[14][13] = '#'; g[14][14] = '#'; g[14][16] = '#'; g[14][17] = '#';
  g[6][10] = '#'; g[7][10] = '#';
  g[11][20] = '#'; g[12][20] = '#';

  return g;
}

function center(tx, ty) {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

// Tile coords used for spawns. These must land on floor in the layout above.
const KILLER_SPAWN_TILE = { x: 15, y: 9 };
const SURVIVOR_SPAWN_TILES = [
  { x: 2, y: 2 },
  { x: 28, y: 2 },
  { x: 2, y: 16 },
  { x: 28, y: 16 },
  { x: 15, y: 2 },
  { x: 15, y: 16 },
  { x: 2, y: 9 },
];

function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// A tile is a valid objective spot if it is floor, not hugging a wall, and
// not sitting on top of a spawn point.
function objectiveCandidates(grid) {
  const spawns = [KILLER_SPAWN_TILE, ...SURVIVOR_SPAWN_TILES];
  const out = [];
  for (let y = 2; y < ROWS - 2; y++) {
    for (let x = 2; x < COLS - 2; x++) {
      if (grid[y][x] !== '.') continue;
      const wallNeighbor =
        grid[y - 1][x] === '#' || grid[y + 1][x] === '#' ||
        grid[y][x - 1] === '#' || grid[y][x + 1] === '#';
      if (wallNeighbor) continue;
      const tooCloseToSpawn = spawns.some(s => chebyshev({ x, y }, s) <= 2);
      if (tooCloseToSpawn) continue;
      out.push({ x, y });
    }
  }
  return out;
}

export function buildMap() {
  const grid = buildGrid();

  // Sanity: every authored spawn must be on floor. Fail fast if the layout
  // and the spawn list ever drift apart.
  if (grid[KILLER_SPAWN_TILE.y][KILLER_SPAWN_TILE.x] !== '.') {
    throw new Error('Killer spawn is not on floor');
  }
  for (const s of SURVIVOR_SPAWN_TILES) {
    if (grid[s.y][s.x] !== '.') {
      throw new Error(`Survivor spawn ${s.x},${s.y} is not on floor`);
    }
  }

  const candidates = objectiveCandidates(grid);
  if (candidates.length < OBJECTIVES_TO_WIN) {
    throw new Error('Map has too few objective candidate tiles');
  }

  // tiles: array of row strings ('#' wall, '.' floor) sent to the client.
  const tiles = grid.map(row => row.join(''));

  return {
    cols: COLS,
    rows: ROWS,
    grid,                                   // 2D array, server-side collision
    tiles,                                  // row strings, sent to client
    killerSpawn: center(KILLER_SPAWN_TILE.x, KILLER_SPAWN_TILE.y),
    survivorSpawns: SURVIVOR_SPAWN_TILES.map(s => center(s.x, s.y)),
    objectiveCandidates: candidates,
  };
}

// Pick N distinct objective spots, spaced out so they aren't clustered.
export function sampleObjectives(map, n) {
  const pool = [...map.objectiveCandidates];
  // shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const chosen = [];
  for (const tile of pool) {
    if (chosen.length >= n) break;
    const spaced = chosen.every(c => chebyshev(c, tile) >= 4);
    if (spaced) chosen.push(tile);
  }
  // If spacing was too strict to fill N, top up with whatever is left.
  for (const tile of pool) {
    if (chosen.length >= n) break;
    if (!chosen.includes(tile)) chosen.push(tile);
  }
  return chosen.map(t => center(t.x, t.y));
}
