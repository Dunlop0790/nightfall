import { Room } from './game.js';
import {
  TICK_RATE, SURVIVOR_HP, OBJECTIVE_TIME, ESCAPE_TIME, BLEEDOUT_TIME, REVIVE_TIME,
} from './constants.js';

function stub() { return { readyState: 1, sent: [], send(d) { this.sent.push(JSON.parse(d)); } }; }
function last(ws, t) { return [...ws.sent].reverse().find(m => m.t === t); }
function ticks(room, seconds) { const n = Math.round(seconds * TICK_RATE); for (let i = 0; i < n; i++) room.update(); }

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('ok  -', name); } else { fail++; console.log('FAIL-', name); } }

// --- setup: killer + 2 survivors ---
const room = new Room();
const wsK = stub(), wsA = stub(), wsB = stub();
room.addPlayer(1, 'Killer', wsK);
room.addPlayer(2, 'SurvA', wsA);
room.addPlayer(3, 'SurvB', wsB);
room.start(1);

check('phase playing', room.phase === 'playing');
const initK = last(wsK, 'init');
check('killer role assigned', initK.role === 'killer');
check('config has escape time 3x objective', initK.config.escapeTime === OBJECTIVE_TIME * 3);
check('config has revive and bleedout', initK.config.reviveTime === REVIVE_TIME && initK.config.bleedoutTime === BLEEDOUT_TIME);
check('gens equal player count', initK.objectives.length === 3);
check('init carries crates', Array.isArray(initK.crates) && initK.crates.length > 0);

const K = room.players.get(1), A = room.players.get(2), B = room.players.get(3);
const spawnDist = Math.hypot(A.x - K.x, A.y - K.y);
check('survivors spawn away from killer', spawnDist > 120);

// --- movement ---
const ax = A.x;
room.setInput(2, { right: true });
ticks(room, 0.5);
check('survivor moves under input', A.x - ax > 20);
room.setInput(2, {});

// --- combat: swing, miss, invuln, downed not dead ---
function placeRightOf(target, p, gap) { p.x = target.x + gap; p.y = target.y; }
room.setInput(1, {}); ticks(room, 0.7);

B.hp = SURVIVOR_HP; B.state = 'up'; B.invulnUntil = 0;
placeRightOf(K, B, 22);
room.setInput(1, { attack: true, aim: Math.PI });
room.update();
check('swing away from target misses', B.hp === SURVIVOR_HP);
room.setInput(1, {}); ticks(room, 0.7);

placeRightOf(K, B, 22);
room.setInput(1, { attack: true, aim: 0 });
room.update();
check('swing toward target lands a hit', B.hp === SURVIVOR_HP - 1);

room.setInput(1, {}); ticks(room, 0.7);
placeRightOf(K, B, 22);
room.setInput(1, { attack: true, aim: 0 });
room.update();
check('invuln prevents a second hit', B.hp === SURVIVOR_HP - 1);

// down B: hp to 0 -> downed, not dead
B.hp = SURVIVOR_HP; B.state = 'up'; B.invulnUntil = 0;
room.setInput(1, {}); ticks(room, 1.0);
for (let i = 0; i < SURVIVOR_HP; i++) {
  placeRightOf(K, B, 22);
  room.setInput(1, { attack: true, aim: 0 });
  room.update();
  room.setInput(1, {});
  ticks(room, 1.0);
}
check('zero hp downs the survivor', B.state === 'downed' && B.hp === 0);
check('one downed one up does not end the round', !last(wsK, 'over'));

// --- revive: teammate holds action nearby ---
A.x = B.x + 10; A.y = B.y;
room.setInput(2, { action: true });
ticks(room, REVIVE_TIME + 0.2);
room.setInput(2, {});
check('teammate revives the downed survivor', B.state === 'up' && B.hp >= 1);

// --- bleed out: downed with no help dies ---
const room2 = new Room();
const k2 = stub(), s2 = stub(), s3 = stub();
room2.addPlayer(10, 'K', k2);
room2.addPlayer(11, 'S1', s2);
room2.addPlayer(12, 'S2', s3);
room2.start(10);
const D = room2.players.get(11);
D.state = 'downed'; D.hp = 0; D.bleedOutAt = room2.elapsed + 1;
ticks(room2, 1.2);
check('downed survivor bleeds out to dead', D.state === 'dead');

// --- co-op repair faster ---
const o = room2.objectives.find(x => !x.done);
const S1 = room2.players.get(12);
S1.x = o.x; S1.y = o.y;
room2.setInput(12, { action: true });
ticks(room2, 1.0);
const solo = o.progress;
check('solo repair accrues progress', solo > 0.5);
room2.setInput(12, {});

// --- exit: button spawns on the border after gens, breach opens, walk out ---
const room3 = new Room();
const k3 = stub(), s4 = stub();
room3.addPlayer(20, 'K', k3);
room3.addPlayer(21, 'S', s4);
room3.start(20);
for (const obj of room3.objectives) { obj.progress = OBJECTIVE_TIME; obj.done = true; }
room3.update();
check('exit button spawns when all gens done', room3.exitSite !== null);
check('gens done does not instantly end round', room3.phase === 'playing');
const gapTiles = room3.exitSite.gap;
check('breach spans 4 border tiles (128px)', gapTiles.length === 4);
const onBorder = gapTiles.every(t =>
  t.x === 0 || t.y === 0 || t.x === room3.map.cols - 1 || t.y === room3.map.rows - 1);
check('breach tiles sit on the border wall', onBorder);

const E = room3.players.get(21);
E.x = room3.exitSite.button.x; E.y = room3.exitSite.button.y;
room3.setInput(21, { action: true });
ticks(room3, ESCAPE_TIME / 2);
check('half the channel does not open the breach', room3.exitOpen === false);
ticks(room3, ESCAPE_TIME / 2 + 0.3);
check('full channel opens the breach', room3.exitOpen === true);
check('breach message broadcast with gap tiles', !!last(k3, 'breach') && last(k3, 'breach').tiles.length === 4);
check('wall tiles became floor', gapTiles.every(t => room3.map.grid[t.y][t.x] === '.'));
check('channeling alone does not escape', E.state === 'up');

// walk into the breach
room3.setInput(21, {});
const g0 = gapTiles[1];
E.x = g0.x * 32 + 16; E.y = g0.y * 32 + 16;
room3.update();
check('walking into the breach escapes', E.state === 'escaped');
check('escape ends round with survivor win', last(k3, 'over') && last(k3, 'over').winner === 'survivors');

// --- killer win: everyone downed/dead, nobody escaped ---
const room4 = new Room();
const k4 = stub(), s5 = stub();
room4.addPlayer(30, 'K', k4);
room4.addPlayer(31, 'S', s5);
room4.start(30);
const L = room4.players.get(31);
L.state = 'downed'; L.hp = 0; L.bleedOutAt = room4.elapsed + 999;
room4.update();
check('all downed with none escaped -> killer wins', last(k4, 'over') && last(k4, 'over').winner === 'killer');

// --- noise pings: sprinting emits, killer receives in state ---
const room5 = new Room();
const k5 = stub(), s6 = stub();
room5.addPlayer(40, 'K', k5);
room5.addPlayer(41, 'S', s6);
room5.start(40);
room5.setInput(41, { right: true, sprint: true });
ticks(room5, 1.0);
const anyNoise = k5.sent.some(m => m.t === 'state' && m.noises && m.noises.length > 0);
check('sprinting emits noise pings', anyNoise);

// --- lunge still hits ---
const room6 = new Room();
const k6 = stub(), s7 = stub();
room6.addPlayer(50, 'K', k6);
room6.addPlayer(51, 'S', s7);
room6.start(50);
const K6 = room6.players.get(50), S7 = room6.players.get(51);
K6.x = 200; K6.y = 200; S7.x = 250; S7.y = 200;
const hp0 = S7.hp;
room6.setInput(50, { lunge: true, aim: 0 });
room6.update();
room6.setInput(50, { aim: 0 });
ticks(room6, 0.25);
check('lunge closes distance and hits', S7.hp < hp0);

// --- killer disconnect -> survivors win ---
const room7 = new Room();
const k7 = stub(), s8 = stub();
room7.addPlayer(60, 'K', k7);
room7.addPlayer(61, 'S', s8);
room7.start(60);
room7.removePlayer(60);
check('killer leaving -> survivors win', last(s8, 'over') && last(s8, 'over').winner === 'survivors');

// --- killer election ---
const room8 = new Room();
const h8 = stub(), c8 = stub(), x8 = stub();
room8.addPlayer(70, 'Host', h8);
room8.addPlayer(71, 'Claimer', c8);
room8.addPlayer(72, 'Third', x8);
room8.claimKiller(71);
check('lobby broadcasts killer elect', last(h8, 'lobby').killer === 71);
room8.start(70);
check('claimer becomes killer', last(c8, 'init').role === 'killer');
check('host becomes survivor when claim exists', last(h8, 'init').role === 'survivor');

const room9 = new Room();
const h9 = stub(), c9 = stub();
room9.addPlayer(80, 'H', h9);
room9.addPlayer(81, 'C', c9);
room9.claimKiller(81); room9.claimKiller(81);
check('unclaim clears elect', last(h9, 'lobby').killer === null);
room9.start(80);
check('host is killer by default', last(h9, 'init').role === 'killer');

// --- med kit: injured survivor walking onto one heals to full ---
const roomM = new Room();
const km = stub(), sm = stub();
roomM.addPlayer(90, 'K', km);
roomM.addPlayer(91, 'S', sm);
roomM.start(90);
const initM = last(sm, 'init');
check('init carries medkits', Array.isArray(initM.medkits) && initM.medkits.length > 0);
const SM = roomM.players.get(91);
SM.hp = 1;
const kit = roomM.medkits[0];
SM.x = kit.x; SM.y = kit.y;
roomM.update();
check('walking onto a medkit heals to full', SM.hp === SURVIVOR_HP);
check('used medkit is removed', roomM.medkits.find(m => m.id === kit.id) === undefined);
check('medkit removal broadcast', !!last(km, 'medkit'));

// full-health survivor does not consume a kit
const kit2 = roomM.medkits[0];
if (kit2) {
  SM.hp = SURVIVOR_HP;
  SM.x = kit2.x; SM.y = kit2.y;
  const before = roomM.medkits.length;
  roomM.update();
  check('full-health survivor leaves the kit', roomM.medkits.length === before);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
