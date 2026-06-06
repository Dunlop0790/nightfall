// Boots the client: connects, drives the lobby UI, runs the render loop with
// local prediction, sends input at a fixed rate, and handles spectating.

import { Net } from './network.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { Renderer } from './renderer.js';

const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const SERVER_URL = isLocal ? 'ws://localhost:3000' : 'wss://nightfall-production.up.railway.app';

const INPUT_RATE = 50; // ms between input sends (20 Hz)

const canvas = document.getElementById('game');
const $ = (id) => document.getElementById(id);

const game = new Game();
const renderer = new Renderer(canvas);
const input = new Input(canvas);

let net = null;
let myId = null;
let isHost = false;
let started = false;
let inMatch = false;

// ---- DOM ----

function showLobby() { $('lobby').style.display = 'flex'; }
function hideLobby() { $('lobby').style.display = 'none'; }
function showBanner(html) { $('banner').innerHTML = html; $('banner').style.display = 'flex'; wireBanner(); }
function hideBanner() { $('banner').style.display = 'none'; }
function setHud(html) { $('hud').innerHTML = html; }

function wireBanner() {
  const b = $('banner').querySelector('[data-start]');
  if (b) b.onclick = () => { net.send({ t: 'start' }); hideBanner(); };
}

function renderLobbyList(players, canStart) {
  const me = players.find(p => p.id === myId);
  isHost = !!(me && me.host);
  $('playerList').innerHTML = players.map(p =>
    `<li>${escapeHtml(p.name)}${p.host ? ' <span class="tag">host</span>' : ''}${p.id === myId ? ' <span class="tag you">you</span>' : ''}</li>`
  ).join('');
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
      renderLobbyList(msg.players, msg.canStart);
      break;
    case 'wait':
      hideLobby();
      showBanner('<h1>Round in progress</h1><p>You will join the next round.</p>');
      break;
    case 'init':
      game.onInit(msg);
      inMatch = true;
      hideLobby();
      hideBanner();
      ensureLoop();
      break;
    case 'state':
      game.onState(msg);
      updateHud();
      break;
    case 'over': {
      const title = msg.winner === 'killer' ? 'The Killer wins' : 'The Survivors escaped';
      const youWon =
        (msg.winner === 'killer' && game.role === 'killer') ||
        (msg.winner === 'survivors' && game.role === 'survivor');
      const btn = isHost ? '<button data-start>Play again</button>' : '<p>Waiting for the host to restart.</p>';
      showBanner(`<h1>${title}</h1><p>${youWon ? 'You won.' : 'You lost.'}</p>${btn}`);
      break;
    }
    case 'full':
      showBanner('<h1>Server full</h1><p>Try again later.</p>');
      break;
  }
}

function pips(hp, max) {
  let s = '';
  for (let i = 0; i < max; i++) s += i < hp ? '\u25c9' : '\u25cb';
  return s;
}

function updateHud() {
  if (!game.config) return;
  const objs = `${game.doneCount()} / ${game.config.objectivesToWin} objectives`;
  const alive = `${game.aliveSurvivors()} alive`;

  if (game.role === 'killer') {
    setHud(`<span class="role killer">KILLER</span><span>${objs}</span><span>${alive}</span><span class="hint">WASD move &middot; mouse aim &middot; SPACE / click attack &middot; SHIFT lunge</span>`);
    return;
  }
  if (!game.localAlive) {
    const name = game.spectateId ? escapeHtml(game.names.get(game.spectateId) || '') : '';
    setHud(`<span class="role dead">DOWNED</span><span>${objs}</span><span>${alive}</span><span class="hint">spectating ${name} &middot; A / D to switch</span>`);
    return;
  }
  const hp = `<span class="pips">${pips(game.localHp, game.config.survivorHp)}</span>`;
  setHud(`<span class="role survivor">SURVIVOR</span>${hp}<span>${objs}</span><span>${alive}</span><span class="hint">WASD move &middot; mouse aim &middot; hold SPACE on a generator</span>`);
}

// ---- spectator switching ----

window.addEventListener('keydown', (e) => {
  if (!inMatch || game.role !== 'survivor' || game.localAlive) return;
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
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (game.config && game.map) {
    game.predict(dt, input.snapshot());
    renderer.draw(game, input, now);
  }
  requestAnimationFrame(frame);
}

// ---- start ----

$('joinBtn').onclick = () => net.send({ t: 'join', name: $('nameInput').value.trim() || 'Player' });
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
$('startBtn').onclick = () => net.send({ t: 'start' });

net = new Net(SERVER_URL, onMessage);
net.onClose(() => showBanner('<h1>Disconnected</h1><p>Refresh to reconnect.</p>'));
