import { Room } from './game.js';
import { TICK_RATE, SURVIVOR_HP } from './constants.js';

function stub() { return { readyState: 1, sent: [], send(d) { this.sent.push(JSON.parse(d)); } }; }
function last(ws, t) { return [...ws.sent].reverse().find(m => m.t === t); }
function ticks(room, seconds) { const n = Math.round(seconds * TICK_RATE); for (let i = 0; i < n; i++) room.update(); }

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('ok  -', name); } else { fail++; console.log('FAIL-', name); } }

// --- setup ---
const room = new Room();
const wsK = stub(), wsA = stub(), wsB = stub();
room.addPlayer(1, 'Killer', wsK);
room.addPlayer(2, 'SurvA', wsA);
room.addPlayer(3, 'SurvB', wsB);
room.start(1);

check('phase playing', room.phase === 'playing');
const initK = last(wsK, 'init');
check('killer role', initK.role === 'killer');
check('config has radii', initK.config.killerRadius > initK.config.survivorRadius);
check('config has hp', initK.config.survivorHp === SURVIVOR_HP);
check('three objectives', initK.objectives.length === 3);

const K = room.players.get(1), A = room.players.get(2), B = room.players.get(3);

// survivors should not be on top of the killer at spawn
const spawnDist = Math.hypot(A.x - K.x, A.y - K.y);
check('survivors spawn away from killer', spawnDist > 120);

// --- movement still works ---
const ax = A.x;
room.setInput(2, { right: true });
ticks(room, 0.5);
check('survivor moves under input', A.x - ax > 20);
room.setInput(2, {});

// --- attack only damages via swing, in the aim arc ---
function placeRightOf(target, p, gap) { p.x = target.x + gap; p.y = target.y; }
room.setInput(1, {}); ticks(room, 0.7);   // clear any attack cooldown

// aim away from B (left, PI) should miss even though B is in range
B.hp = SURVIVOR_HP; B.alive = true; B.invulnUntil = 0;
placeRightOf(K, B, 22);
room.setInput(1, { attack: true, aim: Math.PI });
room.update();
check('swing away from target misses', B.hp === SURVIVOR_HP);
room.setInput(1, {}); ticks(room, 0.7);   // clear cooldown

// aim at B (right, 0 rad) -> hit
placeRightOf(K, B, 22);
room.setInput(1, { attack: true, aim: 0 });
room.update();
check('swing toward target lands a hit', B.hp === SURVIVOR_HP - 1);

// cooldown ready but invuln still active -> swing fires, no damage
room.setInput(1, {}); ticks(room, 0.7);   // 0.7 > cooldown 0.65, < invuln 0.9
placeRightOf(K, B, 22);
room.setInput(1, { attack: true, aim: 0 });
room.update();
check('invuln prevents a second hit', B.hp === SURVIVOR_HP - 1);

// three clean hits down a survivor
B.hp = SURVIVOR_HP; B.alive = true; B.invulnUntil = 0;
room.setInput(1, {}); ticks(room, 1.0);
for (let i = 0; i < SURVIVOR_HP; i++) {
  placeRightOf(K, B, 22);
  room.setInput(1, { attack: true, aim: 0 });
  room.update();
  room.setInput(1, {});
  ticks(room, 1.0);        // clear cooldown + invuln before next hit
}
check('three hits down the survivor', B.alive === false && B.hp === 0);

// one survivor down, one alive -> NOT a killer win
check('one down one alive is not a win', !last(wsK, 'over'));

// --- co-op makes an objective go faster ---
const room2 = new Room();
const k2 = stub(), s2 = stub(), s3 = stub();
room2.addPlayer(10, 'K', k2);
room2.addPlayer(11, 'S1', s2);
room2.addPlayer(12, 'S2', s3);
room2.start(10);
const o = room2.objectives[0];
const S1 = room2.players.get(11), S2 = room2.players.get(12);
// one worker for 1s
S1.x = o.x; S1.y = o.y; S2.x = 99999; S2.y = 99999;
room2.setInput(11, { action: true });
ticks(room2, 1.0);
const solo = room2.objectives[0].progress;
// reset, two workers for 1s
room2.objectives[0].progress = 0;
S2.x = o.x; S2.y = o.y;
room2.setInput(12, { action: true });
ticks(room2, 1.0);
const duo = room2.objectives[0].progress;
check('two workers progress faster than one', duo > solo + 0.001);

// --- survivors win by finishing objectives ---
for (const obj of room2.objectives) obj.done = true;
ticks(room2, 0.1);
check('survivors win on objectives', last(k2, 'over') && last(k2, 'over').winner === 'survivors');

// --- all survivors downed -> killer wins ---
const room3 = new Room();
const k3 = stub(), s4 = stub();
room3.addPlayer(20, 'K', k3);
room3.addPlayer(21, 'S', s4);
room3.start(20);
const onlyS = room3.players.get(21);
onlyS.hp = 0; onlyS.alive = false;
ticks(room3, 0.1);
check('all downed -> killer wins', last(k3, 'over') && last(k3, 'over').winner === 'killer');

// --- lunge dashes and can hit on contact ---
const room4 = new Room();
const k4 = stub(), s5 = stub();
room4.addPlayer(30, 'K', k4);
room4.addPlayer(31, 'S', s5);
room4.start(30);
const K4 = room4.players.get(30), S5 = room4.players.get(31);
K4.x = 200; K4.y = 200; S5.x = 250; S5.y = 200;   // survivor just ahead, to the right
const hp0 = S5.hp;
room4.setInput(30, { lunge: true, aim: 0 });
room4.update();                 // edge triggers lunge
room4.setInput(30, { aim: 0 }); // release lunge key
ticks(room4, 0.25);             // dash plays out
check('lunge closes distance and hits', S5.hp < hp0);

// killer disconnect -> survivors win
const room5 = new Room();
const k5 = stub(), s6 = stub();
room5.addPlayer(40, 'K', k5);
room5.addPlayer(41, 'S', s6);
room5.start(40);
room5.removePlayer(40);
check('killer leaving -> survivors win', last(s6, 'over') && last(s6, 'over').winner === 'survivors');

// --- killer election ---
const room6 = new Room();
const h6 = stub(), c6 = stub(), x6 = stub();
room6.addPlayer(50, 'Host', h6);
room6.addPlayer(51, 'Claimer', c6);
room6.addPlayer(52, 'Third', x6);
room6.claimKiller(51);
check('lobby broadcasts killer elect', last(h6, 'lobby').killer === 51);
room6.start(50);
check('claimer becomes killer', last(c6, 'init').role === 'killer');
check('host becomes survivor when claim exists', last(h6, 'init').role === 'survivor');

const room7 = new Room();
const h7 = stub(), c7 = stub();
room7.addPlayer(60, 'H', h7);
room7.addPlayer(61, 'C', c7);
room7.claimKiller(61); room7.claimKiller(61);   // toggle off
check('unclaim clears elect', last(h7, 'lobby').killer === null);
room7.start(60);
check('host is killer by default', last(h7, 'init').role === 'killer');

const room8 = new Room();
const h8 = stub(), c8 = stub(), x8 = stub();
room8.addPlayer(70, 'H', h8);
room8.addPlayer(71, 'C', c8);
room8.addPlayer(72, 'X', x8);
room8.claimKiller(71);
room8.removePlayer(71);
room8.start(70);
check('elect disconnect falls back to host', last(h8, 'init').role === 'killer');

// --- crates ---
const room9 = new Room();
const i9 = stub(), j9 = stub();
room9.addPlayer(80, 'A', i9);
room9.addPlayer(81, 'B', j9);
room9.start(80);
const init9 = last(i9, 'init');
check('init carries crates', Array.isArray(init9.crates) && init9.crates.length > 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
