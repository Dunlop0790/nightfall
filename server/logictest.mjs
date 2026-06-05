import { Room } from './game.js';
import { TICK_RATE } from './constants.js';

// Stub socket: records messages, always "open".
function stub() { return { readyState: 1, sent: [], send(d) { this.sent.push(JSON.parse(d)); } }; }
function last(ws, t) { return [...ws.sent].reverse().find(m => m.t === t); }
function ticks(room, seconds) { const n = Math.round(seconds * TICK_RATE); for (let i = 0; i < n; i++) room.update(); }

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('ok  -', name); } else { fail++; console.log('FAIL-', name); } }

// --- setup: 1 killer + 2 survivors ---
const room = new Room();
const wsK = stub(), wsA = stub(), wsB = stub();
room.addPlayer(1, 'Killer', wsK);
room.addPlayer(2, 'SurvA', wsA);
room.addPlayer(3, 'SurvB', wsB);

check('host is player 1', last(wsK, 'lobby').players[0].host === true);
check('lobby reports canStart with 3 players', last(wsK, 'lobby').canStart === true);
check('non-host cannot start', (room.start(2), room.phase === 'lobby'));

room.start(1);
check('phase playing after host start', room.phase === 'playing');
const initK = last(wsK, 'init'), initA = last(wsA, 'init');
check('killer got killer role', initK.role === 'killer');
check('survivor got survivor role', initA.role === 'survivor');
check('init carries 3 objectives', initK.objectives.length === 3);
check('init carries config speeds', initK.config.killerSpeed > initK.config.survivorSpeed);

// --- movement + wall collision ---
const sx = room.players.get(2).x;
room.setInput(2, { right: true });
ticks(room, 1.0);
const movedRight = room.players.get(2).x - sx;
check('survivor moved right under input', movedRight > 50);
room.setInput(2, {});

// drive survivor into the left border wall, confirm it cannot pass x<tile
room.players.get(2).x = 40; room.players.get(2).y = 9 * 32 + 16;
room.setInput(2, { left: true });
ticks(room, 2.0);
check('wall stops survivor (x stays > radius)', room.players.get(2).x >= 10);
room.setInput(2, {});

// --- objective completion ---
const obj = room.objectives[0];
const sA = room.players.get(2);
sA.x = obj.x; sA.y = obj.y;       // stand on it
room.setInput(2, { action: true });
ticks(room, 4.2);                  // OBJECTIVE_TIME is 4s
check('objective completes after holding action', room.objectives[0].done === true);
room.setInput(2, {});

// --- killer catch eliminates a survivor ---
const k = room.players.get(1);
const sB = room.players.get(3);
sB.x = k.x; sB.y = k.y;            // overlap the killer
ticks(room, 0.1);
check('survivor caught when overlapping killer', sB.alive === false);

// --- win by objectives: finish remaining two ---
for (const o of room.objectives) { o.done = true; }
ticks(room, 0.1);
check('survivors win when all objectives done', last(wsK, 'over') && last(wsK, 'over').winner === 'survivors');

// --- fresh round, killer wins by catching everyone ---
const room2 = new Room();
const k2 = stub(), s2 = stub();
room2.addPlayer(10, 'K', k2);
room2.addPlayer(11, 'S', s2);
room2.start(10);
const killer2 = room2.players.get(10), surv2 = room2.players.get(11);
surv2.x = killer2.x; surv2.y = killer2.y;
ticks(room2, 0.2);
check('killer wins when last survivor caught', last(k2, 'over') && last(k2, 'over').winner === 'killer');

// --- killer disconnect mid-round -> survivors win ---
const room3 = new Room();
const k3 = stub(), s3 = stub();
room3.addPlayer(20, 'K', k3);
room3.addPlayer(21, 'S', s3);
room3.start(20);
room3.removePlayer(20);
check('killer leaving ends round for survivors', last(s3, 'over') && last(s3, 'over').winner === 'survivors');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
