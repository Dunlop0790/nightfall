// Boots the client: connects, drives the lobby, runs the loop, plays audio on
// game events, and handles spectating.

import { Net } from './network.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { Renderer } from './renderer.js';
import { AudioManager } from './audio.js';

const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const SERVER_URL = isLocal ? 'ws://localhost:3000' : 'wss://nightfall-production.up.railway.app';

const INPUT_RATE = 33;
const HEARTBEAT_RANGE = 480;   // px at which the heartbeat starts

const canvas = document.getElementById('game');
const $ = (id) => document.getElementById(id);

const game = new Game();
const renderer = new Renderer(canvas);
const input = new Input(canvas);
const audio = new AudioManager();

let net = null;
let myId = null;
let isHost = false;
let started = false;
let inMatch = false;

// Previous-frame values for event detection (sound triggers).
let prevHp = null;
let prevState = null;
let prevDone = 0;

// ---- DOM ----

function showLobby() { $('lobby').style.display = 'flex'; }
function hideLobby() { $('lobby').style.display = 'none'; }
function showBanner(html) { $('banner').innerHTML = html; $('banner').style.display = 'flex'; wireBanner(); }
function hideBanner() { $('banner').style.display = 'none'; }
function setHud(html) { $('hud').innerHTML = html; }

function wireBanner() {
  const b = $('banner').querySelector('[data-start]');
  if (b) b.onclick = () => { net.send({ t: 'start' }); hideBanner(); };
  const l = $('banner').querySelector('[data-lobby]');
  if (l) l.onclick = () => { inMatch = false; hideBanner(); showLobby(); };
}

function renderLobbyList(players, canStart, killerId) {
  const me = players.find(p => p.id === myId);
  isHost = !!(me && me.host);
  $('playerList').innerHTML = players.map(p =>
    `<li>${escapeHtml(p.name)}${p.host ? ' <span class="tag">host</span>' : ''}${p.id === killerId ? ' <span class="tag killer">killer</span>' : ''}${p.id === myId ? ' <span class="tag you">you</span>' : ''}</li>`
  ).join('');

  $('killerBtn').textContent = killerId === myId ? 'Pass the killer role' : 'Be the killer';

  const startBtn = $('startBtn');
  if (isHost) {
    startBtn.style.display = 'inline-block';
    startBtn.disabled = !canStart;
    startBtn.textContent = canStart ? 'Start match' : 'Need 2+ players';
    $('hostNote').textContent = '';
  } else {
    startBtn.style.display = 'none';
    $('hostNote').textContent = 'Waiting for the host to start the match.';
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---- messages ----

function onMessage(msg) {
  switch (msg.t) {
    case 'welcome':
      myId = msg.you;
      break;
    case 'lobby':
      if (!inMatch) showLobby();
      $('joinRow').style.display = 'none';
      $('rosterBox').style.display = 'block';
      renderLobbyList(msg.players, msg.canStart, msg.killer);
      break;
    case 'wait':
      hideLobby();
      showBanner('<h1>Round in progress</h1><p>You will join the next round.</p>');
      break;
    case 'init':
      game.onInit(msg);
      inMatch = true;
      prevHp = msg.config.survivorHp;
      prevState = 'up';
      prevDone = 0;
      hideLobby();
      hideBanner();
      ensureLoop();
      break;
    case 'state':
      game.onState(msg);
      detectSoundEvents();
      updateHud();
      break;
    case 'breach':
      game.onBreach(msg.tiles);
      audio.play('escape_open');
      break;
    case 'medkit':
      game.onMedkit(msg.id);
      audio.play('revive');
      break;
    case 'over': {
      const title = msg.winner === 'killer' ? 'The Killer wins' : 'The Survivors escaped';
      const youWon =
        (msg.winner === 'killer' && game.role === 'killer') ||
        (msg.winner === 'survivors' && game.role === 'survivor');
      const startBtn = isHost ? '<button data-start>Play again</button>' : '';
      showBanner(`<h1>${title}</h1><p>${youWon ? 'You won.' : 'You lost.'}</p><div class="bannerRow">${startBtn}<button data-lobby class="ghost">Back to lobby</button></div>`);
      break;
    }
    case 'full':
      showBanner('<h1>Server full</h1><p>Try again later.</p>');
      break;
  }
}

// Compare this state to the last one and fire one-shot sounds on transitions.
function detectSoundEvents() {
  // generator completed (any)
  const done = game.doneCount();
  if (done > prevDone) audio.play('gen_done');
  prevDone = done;

  if (game.role === 'survivor') {
    if (prevHp !== null && game.localHp < prevHp) audio.play('hit');
    prevHp = game.localHp;

    if (prevState !== game.localState) {
      if (game.localState === 'downed') audio.play('down');
      if (prevState === 'downed' && game.localState === 'up') audio.play('revive');
      if (game.localState === 'escaped') audio.play('escaped');
      prevState = game.localState;
    }
  }
}

function pips(hp, max) {
  let s = '';
  for (let i = 0; i < max; i++) s += i < hp ? '\u25c9' : '\u25cb';
  return s;
}

function sprintLabel(info) {
  if (info.state === 'active') return `<span class="sprint active">SPRINT ${info.remaining.toFixed(1)}s</span>`;
  if (info.state === 'cooldown') return `<span class="sprint cooldown">SPRINT cd ${info.remaining.toFixed(1)}s</span>`;
  return `<span class="sprint ready">SPRINT ready</span>`;
}

function updateHud() {
  if (!game.config) return;
  const total = game.config.objectivesToWin;
  const objs = game.exit
    ? (game.exit.open
        ? `<span class="escape">BREACH OPEN - RUN!</span>`
        : `<span class="escape">LOAD THE EXIT: ${Math.round(game.exit.charge * 100)}%</span>`)
    : `${game.doneCount()} / ${total} generators`;
  const alive = `${game.upSurvivors()} standing`;
  const sprint = sprintLabel(game.sprintInfo());

  if (game.role === 'killer') {
    setHud(`<span class="role killer">KILLER</span><span>${objs}</span><span>${alive}</span>${sprint}<span class="hint">WASD &middot; SPACE attack &middot; SHIFT sprint/lunge</span>`);
    return;
  }
  if (game.localState === 'downed') {
    const me = game.selfEntry();
    const secs = me && typeof me.bleed === 'number' ? Math.ceil(me.bleed * game.config.bleedoutTime) : 0;
    setHud(`<span class="role dead">DOWNED</span><span class="bleed">bleeding out: ${secs}s</span><span>${objs}</span><span class="hint">a teammate can revive you</span>`);
    return;
  }
  if (game.localState === 'dead') {
    const name = game.spectateId ? escapeHtml(game.names.get(game.spectateId) || '') : '';
    setHud(`<span class="role dead">DEAD</span><span>${objs}</span><span>${alive}</span><span class="hint">spectating ${name} &middot; A / D to switch</span>`);
    return;
  }
  if (game.localState === 'escaped') {
    const name = game.spectateId ? escapeHtml(game.names.get(game.spectateId) || '') : '';
    setHud(`<span class="role escaped">ESCAPED</span><span>${alive}</span><span class="hint">spectating ${name} &middot; A / D to switch</span>`);
    return;
  }
  const hp = `<span class="pips">${pips(game.localHp, game.config.survivorHp)}</span>`;
  setHud(`<span class="role survivor">SURVIVOR</span>${hp}<span>${objs}</span><span>${alive}</span>${sprint}<span class="hint">WASD &middot; SHIFT sprint &middot; SPACE interact</span>`);
}

// ---- spectator switching ----

window.addEventListener('keydown', (e) => {
  if (!inMatch || game.role !== 'survivor') return;
  if (game.localState !== 'dead' && game.localState !== 'escaped') return;
  if (e.code === 'ArrowLeft' || e.code === 'KeyA') { game.cycleSpectate(-1); updateHud(); }
  if (e.code === 'ArrowRight' || e.code === 'KeyD') { game.cycleSpectate(1); updateHud(); }
});

// ---- loop + input ----

let lastTime = 0;
function ensureLoop() {
  if (started) return;
  started = true;
  lastTime = performance.now();
  requestAnimationFrame(frame);
  setInterval(() => { if (net && inMatch) net.send({ t: 'input', ...input.snapshot() }); }, INPUT_RATE);
}

function frame(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  if (game.config && game.map) {
    game.predict(dt, input.snapshot());
    renderer.draw(game, input, now);
    updateHeartbeat();
  }
  requestAnimationFrame(frame);
}

// Heartbeat volume scales with killer proximity, for up survivors only.
function updateHeartbeat() {
  if (game.role !== 'survivor' || game.localState !== 'up' || !game.curr) {
    audio.setHeartbeat(0);
    return;
  }
  let killerPos = null;
  for (const [id, role] of game.roles) {
    if (role === 'killer') { killerPos = game.curr.players.get(id); break; }
  }
  if (!killerPos) { audio.setHeartbeat(0); return; }
  const self = game.selfPos();
  const d = Math.hypot(self.x - killerPos.x, self.y - killerPos.y);
  audio.setHeartbeat(Math.max(0, 1 - d / HEARTBEAT_RANGE));
}

// ---- start ----

$('joinBtn').onclick = () => {
  audio.unlock();   // user gesture: browser now allows playback
  net.send({ t: 'join', name: $('nameInput').value.trim() || 'Player' });
};
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
$('startBtn').onclick = () => net.send({ t: 'start' });
$('killerBtn').onclick = () => net.send({ t: 'claimKiller' });

net = new Net(SERVER_URL, onMessage);
net.onClose(() => showBanner('<h1>Disconnected</h1><p>Refresh to reconnect.</p>'));
