// Boots the client: connects, drives the lobby UI, runs the render loop with
// local prediction, and pushes input to the server on change.

import { Net } from './network.js';
import { Input } from './input.js';
import { Game } from './game.js';
import { Renderer } from './renderer.js';

// Single source for the server address. Replace the production host with your
// Railway domain. Local development talks to a server on localhost:3000.
const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const SERVER_URL = isLocal
  ? 'ws://localhost:3000'
  : 'wss://nightfall-production.up.railway.app';

const canvas = document.getElementById('game');
const $ = (id) => document.getElementById(id);

const game = new Game();
const renderer = new Renderer(canvas);

let net = null;
let myId = null;
let isHost = false;
let started = false;   // render loop running
let inMatch = false;   // we have init + are playing/over

const input = new Input(canvas, (snap) => {
  if (net && inMatch) net.send({ t: 'input', ...snap });
});

// ---- DOM helpers ----

function showLobby() { $('lobby').style.display = 'flex'; }
function hideLobby() { $('lobby').style.display = 'none'; }
function showBanner(html) { $('banner').innerHTML = html; $('banner').style.display = 'flex'; wireBannerButtons(); }
function hideBanner() { $('banner').style.display = 'none'; }
function setHud(html) { $('hud').innerHTML = html; }

function wireBannerButtons() {
  const b = $('banner').querySelector('[data-start]');
  if (b) b.onclick = () => { net.send({ t: 'start' }); hideBanner(); };
}

function renderLobbyList(players, canStart) {
  const me = players.find(p => p.id === myId);
  isHost = !!(me && me.host);
  const rows = players.map(p =>
    `<li>${escapeHtml(p.name)}${p.host ? ' <span class="tag">host</span>' : ''}${p.id === myId ? ' <span class="tag you">you</span>' : ''}</li>`
  ).join('');
  $('playerList').innerHTML = rows;
  const startBtn = $('startBtn');
  if (isHost) {
    startBtn.style.display = 'inline-block';
    startBtn.disabled = !canStart;
    startBtn.textContent = canStart ? 'Start match' : 'Need 2+ players';
  } else {
    startBtn.style.display = 'none';
    $('hostNote').textContent = 'Waiting for the host to start the match.';
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---- message handling ----

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
      const youWon =
        (msg.winner === 'killer' && game.role === 'killer') ||
        (msg.winner === 'survivors' && game.role === 'survivor');
      const title = msg.winner === 'killer' ? 'The Killer wins' : 'The Survivors escaped';
      const sub = youWon ? 'You won.' : 'You lost.';
      const startBtn = isHost ? '<button data-start>Play again</button>' : '<p>Waiting for the host to restart.</p>';
      showBanner(`<h1>${title}</h1><p>${sub}</p>${startBtn}`);
      break;
    }

    case 'full':
      showBanner('<h1>Server full</h1><p>Try again later.</p>');
      break;
  }
}

function updateHud() {
  if (!game.config) return;
  const roleLabel = game.role === 'killer' ? 'KILLER' : 'SURVIVOR';
  const objs = `${game.doneCount()} / ${game.config.objectivesToWin} objectives`;
  const alive = `${game.aliveSurvivors()} survivors alive`;
  const status = (game.role === 'survivor' && !game.localAlive) ? ' &middot; caught (spectating)' : '';
  setHud(`<span class="role ${game.role}">${roleLabel}</span><span>${objs}</span><span>${alive}</span><span class="hint">WASD move &middot; ${game.role === 'survivor' ? 'mouse aim flashlight &middot; hold Space to repair' : 'hunt the survivors'}${status}</span>`);
}

// ---- loop ----

let lastTime = 0;
function ensureLoop() {
  if (started) return;
  started = true;
  lastTime = performance.now();
  requestAnimationFrame(frame);
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

$('joinBtn').onclick = () => {
  const name = $('nameInput').value.trim() || 'Player';
  net.send({ t: 'join', name });
};
$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
$('startBtn').onclick = () => net.send({ t: 'start' });

net = new Net(SERVER_URL, onMessage);
net.onClose(() => showBanner('<h1>Disconnected</h1><p>Refresh to reconnect.</p>'));
